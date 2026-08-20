import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchMonths, type MonthResult } from './molit';
import { isSupabaseConfigured, serverClient } from './supabase';
import { addMonths, monthRange, toYm } from './months';
import type { Trade } from './types';

/**
 * 거래 데이터 저장소.
 *
 *  - Supabase 환경변수가 있으면 Postgres 에 적재하고 거기서 읽는다(권장).
 *  - 없으면 람다 메모리 캐시로 동작한다. 첫 조회가 느리고 배포마다 날아가지만,
 *    키 하나만으로 바로 돌려볼 수 있다.
 *
 *  국토부 API 는 (시군구 × 1개월) 단위라 3년 = 36회 호출이다. 그래서 이미 받은 월은
 *  `ingest_log` 에 기록해 두고 다시 부르지 않는다. 단, 실거래 신고 기한이 계약일로부터
 *  30일이라 최근 3개월치는 계속 늘어나므로 일정 시간이 지나면 다시 받는다.
 */

const RECENT_MONTHS_TO_REFRESH = 3;
const RECENT_TTL_MS = 6 * 60 * 60 * 1000; // 최근 월: 6시간
const OLD_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 확정된 과거 월: 90일

export type StoreMode = 'supabase' | 'memory';

export function storeMode(): StoreMode {
  return isSupabaseConfigured() ? 'supabase' : 'memory';
}

function supabase(): SupabaseClient {
  return serverClient();
}

/**
 * 행 식별자.
 *
 * 국토부 신고 자료에는 **같은 단지·같은 계약일·같은 층·같은 면적·같은 금액** 거래가
 * 실제로 여러 건 존재한다 (같은 평형의 다른 동. 강남구 2026-05 은 462건 중 14개 키가
 * 중복이었다). 이걸 하나로 합치면 거래 건수를 3% 가까이 잃고, 한 배치 안에서 같은 키를
 * 두 번 upsert 하면 Postgres 가 "ON CONFLICT DO UPDATE command cannot affect row a
 * second time" 로 거부한다. 그래서 동일 키에는 접미 번호를 붙여 전부 보존한다.
 */
function assignIds(trades: Trade[]): string[] {
  const seen = new Map<string, number>();
  return trades.map((t) => {
    const base = `${t.aptSeq}|${t.dealDate}|${t.area}|${t.floor ?? ''}|${t.amount}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  });
}

/** 접미 번호가 흔들리지 않도록 항상 같은 순서로 정렬한다. */
function stableSort(trades: Trade[]): Trade[] {
  return [...trades].sort(
    (a, b) =>
      a.dealDate.localeCompare(b.dealDate) ||
      a.aptSeq.localeCompare(b.aptSeq) ||
      a.area - b.area ||
      (a.floor ?? 0) - (b.floor ?? 0) ||
      a.amount - b.amount ||
      (a.rgstDate ?? '').localeCompare(b.rgstDate ?? ''),
  );
}

/** 이 월이 아직 갱신 대상인지 (신고 지연 때문에 최근 몇 달은 계속 늘어난다) */
function ttlFor(ym: string, now = new Date()): number {
  const cutoff = addMonths(toYm(now), -(RECENT_MONTHS_TO_REFRESH - 1));
  return ym >= cutoff ? RECENT_TTL_MS : OLD_TTL_MS;
}

// ── 메모리 모드 ─────────────────────────────────────────────────────────

type MemEntry = { trades: Trade[]; at: number };
const mem = new Map<string, MemEntry>();

function memGet(lawdCd: string, ym: string): Trade[] | null {
  const e = mem.get(`${lawdCd}:${ym}`);
  if (!e) return null;
  if (Date.now() - e.at > ttlFor(ym)) return null;
  return e.trades;
}

function memPut(lawdCd: string, ym: string, trades: Trade[]): void {
  mem.set(`${lawdCd}:${ym}`, { trades, at: Date.now() });
  // 람다 메모리 보호: 오래된 순으로 정리
  if (mem.size > 400) {
    const oldest = [...mem.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) mem.delete(k);
  }
}

// ── Supabase 모드 ───────────────────────────────────────────────────────

async function freshMonths(lawdCd: string, yms: string[]): Promise<Set<string>> {
  const { data, error } = await supabase()
    .from('ingest_log')
    .select('deal_ym, fetched_at')
    .eq('lawd_cd', lawdCd)
    .in('deal_ym', yms);
  if (error) throw new Error(`ingest_log 조회 실패: ${error.message}`);

  const fresh = new Set<string>();
  for (const row of data ?? []) {
    const age = Date.now() - new Date(row.fetched_at as string).getTime();
    if (age < ttlFor(row.deal_ym as string)) fresh.add(row.deal_ym as string);
  }
  return fresh;
}

/**
 * 성공적으로 받아온 월을 **월 단위로 통째로 교체**한다.
 *
 * 부분 upsert 가 아니라 delete → insert 인 이유:
 *  · 해제된 거래가 원본에서 사라지면 DB 에도 사라져야 한다
 *  · 위의 동일 키 중복을 접미 번호로 다루려면 그 달의 집합을 다시 세워야 한다
 * 월별로 커밋하므로 뒤쪽 달이 실패해도 앞쪽 달은 기록된 상태로 남는다.
 */
async function replaceMonths(lawdCd: string, results: MonthResult[]): Promise<void> {
  const db = supabase();

  for (const r of results) {
    if (r.error) continue;

    const { error: delErr } = await db
      .from('apt_trade')
      .delete()
      .eq('lawd_cd', lawdCd)
      .eq('deal_ym', r.ym);
    if (delErr) throw new Error(`apt_trade 정리 실패(${r.ym}): ${delErr.message}`);

    // 요청한 달과 다른 달의 행이 섞여 오면 넣지 않는다 — 그 달을 조회할 때 받으면 된다.
    const trades = stableSort(r.trades.filter((t) => t.dealYm === r.ym));
    const ids = assignIds(trades);
    const rows = trades.map((t, i) => ({
      id: ids[i],
      lawd_cd: t.lawdCd,
      deal_ym: t.dealYm,
      apt_seq: t.aptSeq,
      apt_nm: t.aptNm,
      umd_nm: t.umdNm,
      jibun: t.jibun,
      road_nm: t.roadNm,
      build_year: t.buildYear,
      area: t.area,
      floor: t.floor,
      deal_date: t.dealDate,
      amount: t.amount,
      dealing_gbn: t.dealingGbn,
      buyer_gbn: t.buyerGbn,
      sler_gbn: t.slerGbn,
      canceled: t.canceled,
      rgst_date: t.rgstDate,
      updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('apt_trade').insert(rows.slice(i, i + 500));
      if (error) throw new Error(`apt_trade 적재 실패(${r.ym}): ${error.message}`);
    }

    const { error: logErr } = await db
      .from('ingest_log')
      .upsert(
        { lawd_cd: lawdCd, deal_ym: r.ym, rows: rows.length, fetched_at: new Date().toISOString() },
        { onConflict: 'lawd_cd,deal_ym' },
      );
    if (logErr) throw new Error(`ingest_log 기록 실패(${r.ym}): ${logErr.message}`);
  }
}

async function selectTrades(lawdCd: string, from: string, to: string): Promise<Trade[]> {
  const db = supabase();
  const out: Trade[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 60_000; offset += PAGE) {
    const { data, error } = await db
      .from('apt_trade')
      .select('*')
      .eq('lawd_cd', lawdCd)
      .gte('deal_ym', from)
      .lte('deal_ym', to)
      .order('deal_date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`apt_trade 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Record<string, any>[]) {
      out.push({
        aptSeq: r.apt_seq,
        lawdCd: r.lawd_cd,
        umdNm: r.umd_nm ?? '',
        aptNm: r.apt_nm,
        jibun: r.jibun,
        roadNm: r.road_nm,
        buildYear: r.build_year,
        area: Number(r.area),
        floor: r.floor,
        dealDate: r.deal_date,
        dealYm: r.deal_ym,
        amount: Number(r.amount),
        dealingGbn: r.dealing_gbn,
        buyerGbn: r.buyer_gbn,
        slerGbn: r.sler_gbn,
        canceled: Boolean(r.canceled),
        rgstDate: r.rgst_date,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

// ── 공용 API ────────────────────────────────────────────────────────────

export type RegionData = {
  trades: Trade[];
  mode: StoreMode;
  /** 이번 요청에서 국토부 API 를 새로 호출한 월 수 */
  fetchedMonths: number;
  /** 국토부 API 호출이 실패한 월과 사유 */
  errors: { ym: string; message: string }[];
};

/**
 * 시군구 1곳의 from~to 거래를 반환한다. 없는 달은 국토부에서 받아 채운다.
 * @param onlyCached true 면 API 호출 없이 저장된 것만 반환 (빠른 응답용)
 * @param force true 면 TTL 을 무시하고 이 구간을 전부 다시 받는다 (크론 갱신용)
 */
export async function getRegionTrades(
  lawdCd: string,
  from: string,
  to: string,
  opts: { onlyCached?: boolean; concurrency?: number; force?: boolean } = {},
): Promise<RegionData> {
  const yms = monthRange(from, to);
  const mode = storeMode();
  const errors: { ym: string; message: string }[] = [];

  if (mode === 'memory') {
    const cached = new Map<string, Trade[]>();
    const missing: string[] = [];
    for (const ym of yms) {
      const hit = opts.force ? null : memGet(lawdCd, ym);
      if (hit) cached.set(ym, hit);
      else missing.push(ym);
    }
    if (!opts.onlyCached && missing.length > 0) {
      const results = await fetchMonths(lawdCd, missing, {
        concurrency: opts.concurrency ?? 6,
      });
      for (const r of results) {
        if (r.error) errors.push({ ym: r.ym, message: r.error });
        else {
          memPut(lawdCd, r.ym, r.trades);
          cached.set(r.ym, r.trades);
        }
      }
    }
    const trades = yms.flatMap((ym) => cached.get(ym) ?? []);
    assertUsable(trades, missing, errors);
    return { trades, mode, fetchedMonths: missing.length, errors };
  }

  // supabase 모드
  // force 면 ingest_log 를 보지 않고 전 구간을 다시 받는다. 예전에는 크론이
  // ingest_log 를 지워서 강제했는데, 그러면 도중에 함수가 끊길 때 "받은 적 없는 달"로
  // 보여 커버리지 집계에서 사라졌다.
  const fresh = opts.force ? new Set<string>() : await freshMonths(lawdCd, yms);
  const missing = yms.filter((ym) => !fresh.has(ym));

  if (!opts.onlyCached && missing.length > 0) {
    const results = await fetchMonths(lawdCd, missing, {
      concurrency: opts.concurrency ?? 6,
    });
    for (const r of results) if (r.error) errors.push({ ym: r.ym, message: r.error });
    await replaceMonths(lawdCd, results);
  }

  const trades = await selectTrades(lawdCd, from, to);
  assertUsable(trades, missing, errors);
  return { trades, mode, fetchedMonths: opts.onlyCached ? 0 : missing.length, errors };
}

/**
 * 받아온 게 하나도 없는데 요청한 달이 전부 실패했다면 그건 "거래 0건"이 아니라 장애다.
 * 조용히 빈 화면을 주면 사용자가 원인을 알 수 없으므로 그대로 올린다.
 */
function assertUsable(
  trades: Trade[],
  requested: string[],
  errors: { ym: string; message: string }[],
): void {
  if (trades.length > 0) return;
  if (requested.length === 0 || errors.length < requested.length) return;
  throw new Error(errors[0].message);
}

/**
 * 최근 몇 달 기준으로 "갱신이 가장 오래된 지역" 순서. 크론이 이 순서로 돈다.
 *
 * 별도 커서 테이블을 두지 않고 ingest_log 의 fetched_at 을 그대로 쓴다 —
 * 한 번에 다 돌지 못해도 다음 실행이 자연히 뒤에서 이어받고, 실행이 끊겨도
 * 상태가 어긋나지 않는다.
 */
export async function regionsByStaleness(
  months: string[],
): Promise<{ lawdCd: string; oldestFetchedAt: number }[]> {
  const { data, error } = await supabase()
    .from('ingest_log')
    .select('lawd_cd, fetched_at')
    .in('deal_ym', months);
  if (error) throw new Error(`ingest_log 조회 실패: ${error.message}`);

  const oldest = new Map<string, number>();
  for (const row of data ?? []) {
    const code = row.lawd_cd as string;
    const at = new Date(row.fetched_at as string).getTime();
    const cur = oldest.get(code);
    if (cur === undefined || at < cur) oldest.set(code, at);
  }
  return [...oldest.entries()]
    .map(([lawdCd, oldestFetchedAt]) => ({ lawdCd, oldestFetchedAt }))
    .sort((a, b) => a.oldestFetchedAt - b.oldestFetchedAt);
}

/** 특정 단지의 거래만 (시군구 데이터를 받은 뒤 필터) */
export function filterComplex(trades: Trade[], aptSeq: string): Trade[] {
  return trades.filter((t) => t.aptSeq === aptSeq);
}

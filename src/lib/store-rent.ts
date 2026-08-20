import { fetchRentMonths, type RentMonthResult } from './molit-rent';
import { monthRange } from './months';
import { storeMode, ttlFor, type StoreMode } from './store';
import { serverClient } from './supabase';
import type { Rent } from './types';

/**
 * 전월세 저장소.
 *
 * 매매(`store.ts`)와 흐름이 같다: 없는 달만 받아 (시군구 × 계약년월) 단위로 통째
 * 교체하고, 받은 달은 `rent_ingest_log` 에 기록한다. 매매와 표를 나눈 이유는
 * 전월세 API 에 aptSeq 가 없어 컬럼 구성 자체가 다르기 때문이다.
 */

const RENT_CONCURRENCY = 4;

/** 전월세 표가 아직 없을 때(스키마 미적용) 알아보기 쉬운 메시지로 바꿔 준다. */
function wrapDbError(prefix: string, message: string): Error {
  if (/does not exist|schema cache/i.test(message)) {
    return new Error(
      '전월세 테이블이 없습니다. src/lib/schema.sql 의 apt_rent / rent_ingest_log 부분을 ' +
        'Supabase SQL Editor 에서 실행하거나 npm run db:setup 을 다시 돌려주세요. (' +
        message +
        ')',
    );
  }
  return new Error(prefix + ': ' + message);
}

// ── 메모리 모드 ─────────────────────────────────────────────────────────

const mem = new Map<string, { rents: Rent[]; at: number }>();

function memGet(lawdCd: string, ym: string): Rent[] | null {
  const e = mem.get(`${lawdCd}:${ym}`);
  if (!e) return null;
  if (Date.now() - e.at > ttlFor(ym)) return null;
  return e.rents;
}

function memPut(lawdCd: string, ym: string, rents: Rent[]): void {
  mem.set(`${lawdCd}:${ym}`, { rents, at: Date.now() });
  if (mem.size > 400) {
    const oldest = [...mem.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) mem.delete(k);
  }
}

// ── 행 식별자 ───────────────────────────────────────────────────────────

/**
 * 매매와 같은 이유로 동일 키 신고가 여럿 존재할 수 있어 접미 번호를 붙인다.
 * aptSeq 가 없으니 법정동·단지명·지번을 키에 포함한다.
 */
function assignIds(rents: Rent[]): string[] {
  const seen = new Map<string, number>();
  return rents.map((r) => {
    const base = [
      r.umdNm,
      r.aptNm,
      r.jibun ?? '',
      r.dealDate,
      r.area,
      r.floor ?? '',
      r.deposit,
      r.monthlyRent,
    ].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : base + '#' + n;
  });
}

/** 접미 번호가 흔들리지 않도록 항상 같은 순서로 정렬한다. */
function stableSort(rents: Rent[]): Rent[] {
  return [...rents].sort(
    (a, b) =>
      a.dealDate.localeCompare(b.dealDate) ||
      a.aptNm.localeCompare(b.aptNm) ||
      a.area - b.area ||
      (a.floor ?? 0) - (b.floor ?? 0) ||
      a.deposit - b.deposit ||
      a.monthlyRent - b.monthlyRent,
  );
}

// ── Supabase 모드 ───────────────────────────────────────────────────────

async function freshMonths(lawdCd: string, yms: string[]): Promise<Set<string>> {
  const { data, error } = await serverClient()
    .from('rent_ingest_log')
    .select('deal_ym, fetched_at')
    .eq('lawd_cd', lawdCd)
    .in('deal_ym', yms);
  if (error) throw wrapDbError('rent_ingest_log 조회 실패', error.message);

  const fresh = new Set<string>();
  for (const row of data ?? []) {
    const age = Date.now() - new Date(row.fetched_at as string).getTime();
    if (age < ttlFor(row.deal_ym as string)) fresh.add(row.deal_ym as string);
  }
  return fresh;
}

async function replaceMonths(lawdCd: string, results: RentMonthResult[]): Promise<void> {
  const db = serverClient();

  for (const r of results) {
    if (r.error) continue;

    const { error: delErr } = await db
      .from('apt_rent')
      .delete()
      .eq('lawd_cd', lawdCd)
      .eq('deal_ym', r.ym);
    if (delErr) throw wrapDbError('apt_rent 정리 실패(' + r.ym + ')', delErr.message);

    const rents = stableSort(r.rents.filter((x) => x.dealYm === r.ym));
    const ids = assignIds(rents);
    const rows = rents.map((x, i) => ({
      id: ids[i],
      lawd_cd: x.lawdCd,
      deal_ym: x.dealYm,
      umd_nm: x.umdNm,
      apt_nm: x.aptNm,
      jibun: x.jibun,
      build_year: x.buildYear,
      area: x.area,
      floor: x.floor,
      deal_date: x.dealDate,
      deposit: x.deposit,
      monthly_rent: x.monthlyRent,
      contract_term: x.contractTerm,
      contract_type: x.contractType,
      pre_deposit: x.preDeposit,
      pre_monthly_rent: x.preMonthlyRent,
      use_rr_right: x.useRRRight,
      updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('apt_rent').insert(rows.slice(i, i + 500));
      if (error) throw wrapDbError('apt_rent 적재 실패(' + r.ym + ')', error.message);
    }

    const { error: logErr } = await db.from('rent_ingest_log').upsert(
      {
        lawd_cd: lawdCd,
        deal_ym: r.ym,
        rows: rows.length,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'lawd_cd,deal_ym' },
    );
    if (logErr) throw new Error('rent_ingest_log 기록 실패(' + r.ym + '): ' + logErr.message);
  }
}

/**
 * 전월세 행 조회.
 *
 * 시군구 전월세는 매매보다 5배 가까이 많다(강남구 3년 69,026행). 전에는 임의 상한에서
 * 멈췄는데, 오름차순 정렬이라 **가장 최근 데이터가 잘려나갔다** — 조용한 데이터 손실이
 * 가장 나쁜 종류의 버그다. 이제
 *  · 짧은 페이지가 올 때까지 끝까지 읽고
 *  · 그래도 안전 상한에 닿으면 예외를 던져 알린다 (조용히 자르지 않는다)
 *  · 필요한 만큼만 서버에서 걸러 받는다 (단지 지정 / 전세만 / 컬럼 축소)
 */
const SELECT_PAGE = 1000;
const SELECT_HARD_LIMIT = 400_000;

const RENT_COLUMNS =
  'lawd_cd, umd_nm, apt_nm, jibun, build_year, area, floor, deal_date, deal_ym, ' +
  'deposit, monthly_rent, contract_term, contract_type, pre_deposit, pre_monthly_rent, use_rr_right';

/** 지수 산출에는 이 컬럼만 있으면 된다 — 69,000행을 통째로 끌어오지 않기 위함 */
const INDEX_COLUMNS = 'lawd_cd, umd_nm, apt_nm, jibun, area, floor, deal_date, deal_ym, deposit, monthly_rent';

function rowToRent(r: Record<string, unknown>): Rent {
  return {
    lawdCd: String(r.lawd_cd),
    umdNm: r.umd_nm == null ? '' : String(r.umd_nm),
    aptNm: String(r.apt_nm),
    jibun: r.jibun == null ? null : String(r.jibun),
    buildYear: r.build_year == null ? null : Number(r.build_year),
    area: Number(r.area),
    floor: r.floor == null ? null : Number(r.floor),
    dealDate: String(r.deal_date),
    dealYm: String(r.deal_ym),
    deposit: Number(r.deposit),
    monthlyRent: Number(r.monthly_rent ?? 0),
    contractTerm: r.contract_term == null ? null : String(r.contract_term),
    contractType: r.contract_type == null ? null : String(r.contract_type),
    preDeposit: r.pre_deposit == null ? null : Number(r.pre_deposit),
    preMonthlyRent: r.pre_monthly_rent == null ? null : Number(r.pre_monthly_rent),
    useRRRight: r.use_rr_right == null ? null : String(r.use_rr_right),
  };
}

export type RentQuery = {
  /** 전세(월세 0)만 — 지수·추정에 쓸 때 */
  jeonseOnly?: boolean;
  /** 특정 단지만 (법정동 + 단지명) */
  umdNm?: string;
  aptNm?: string;
  /** 지수용 축소 컬럼만 읽기 */
  slim?: boolean;
};

async function selectRents(
  lawdCd: string,
  from: string,
  to: string,
  q: RentQuery = {},
): Promise<Rent[]> {
  const db = serverClient();
  const out: Rent[] = [];

  for (let offset = 0; offset < SELECT_HARD_LIMIT; offset += SELECT_PAGE) {
    let query = db
      .from('apt_rent')
      .select(q.slim ? INDEX_COLUMNS : RENT_COLUMNS)
      .eq('lawd_cd', lawdCd)
      .gte('deal_ym', from)
      .lte('deal_ym', to);

    if (q.jeonseOnly) query = query.eq('monthly_rent', 0);
    if (q.umdNm) query = query.eq('umd_nm', q.umdNm);
    if (q.aptNm) query = query.eq('apt_nm', q.aptNm);

    // 혹시라도 상한에 닿아 잘릴 경우 최신 데이터가 남도록 내림차순으로 읽는다.
    const { data, error } = await query
      .order('deal_date', { ascending: false })
      .range(offset, offset + SELECT_PAGE - 1);
    if (error) throw wrapDbError('apt_rent 조회 실패', error.message);
    if (!data || data.length === 0) return out;

    for (const r of data as unknown as Record<string, unknown>[]) out.push(rowToRent(r));
    if (data.length < SELECT_PAGE) return out;
  }

  throw new Error(
    `apt_rent 조회가 안전 상한(${SELECT_HARD_LIMIT.toLocaleString('ko-KR')}행)에 닿았습니다. ` +
      '조건을 좁히거나 상한을 올려야 합니다 — 조용히 자르면 최근 데이터가 사라집니다.',
  );
}

// ── 공용 API ────────────────────────────────────────────────────────────

export type RegionRentData = {
  rents: Rent[];
  mode: StoreMode;
  /** 이번 요청에서 국토부 API 를 새로 호출한 월 수 */
  fetchedMonths: number;
  errors: { ym: string; message: string }[];
};

/**
 * 시군구 1곳의 from~to 전월세 신고를 반환한다. 없는 달은 국토부에서 받아 채운다.
 * @param force TTL 을 무시하고 전 구간 다시 받기 (크론 갱신용)
 */
export async function getRegionRents(
  lawdCd: string,
  from: string,
  to: string,
  opts: {
    onlyCached?: boolean;
    concurrency?: number;
    force?: boolean;
    /** 반환할 행을 좁힌다. 수집(적재)은 항상 시군구 전체로 하고, 읽기만 걸러진다. */
    query?: RentQuery;
  } = {},
): Promise<RegionRentData> {
  const yms = monthRange(from, to);
  const mode = storeMode();
  const errors: { ym: string; message: string }[] = [];
  const concurrency = opts.concurrency ?? RENT_CONCURRENCY;

  /** 하나도 못 받았는데 요청한 달이 전부 실패면 "0건"이 아니라 장애다. */
  const assertUsable = (rents: Rent[], missing: string[]) => {
    if (rents.length > 0) return;
    if (missing.length === 0 || errors.length < missing.length) return;
    throw new Error(errors[0].message);
  };

  if (mode === 'memory') {
    const cached = new Map<string, Rent[]>();
    const missing: string[] = [];
    for (const ym of yms) {
      const hit = opts.force ? null : memGet(lawdCd, ym);
      if (hit) cached.set(ym, hit);
      else missing.push(ym);
    }
    if (!opts.onlyCached && missing.length > 0) {
      const results = await fetchRentMonths(lawdCd, missing, { concurrency });
      for (const r of results) {
        if (r.error) errors.push({ ym: r.ym, message: r.error });
        else {
          memPut(lawdCd, r.ym, r.rents);
          cached.set(r.ym, r.rents);
        }
      }
    }
    let rents = yms.flatMap((ym) => cached.get(ym) ?? []);
    assertUsable(rents, missing);
    // 메모리 모드에서는 받아둔 것을 같은 조건으로 걸러 준다 (DB 모드와 결과를 맞춘다)
    const q = opts.query;
    if (q) {
      rents = rents.filter(
        (r) =>
          (!q.jeonseOnly || r.monthlyRent === 0) &&
          (!q.umdNm || r.umdNm === q.umdNm) &&
          (!q.aptNm || r.aptNm === q.aptNm),
      );
    }
    return { rents, mode, fetchedMonths: missing.length, errors };
  }

  const fresh = opts.force ? new Set<string>() : await freshMonths(lawdCd, yms);
  const missing = yms.filter((ym) => !fresh.has(ym));

  if (!opts.onlyCached && missing.length > 0) {
    const results = await fetchRentMonths(lawdCd, missing, { concurrency });
    for (const r of results) if (r.error) errors.push({ ym: r.ym, message: r.error });
    await replaceMonths(lawdCd, results);
  }

  const rents = await selectRents(lawdCd, from, to, opts.query);
  assertUsable(rents, missing);
  return { rents, mode, fetchedMonths: opts.onlyCached ? 0 : missing.length, errors };
}

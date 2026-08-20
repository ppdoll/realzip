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

async function selectRents(lawdCd: string, from: string, to: string): Promise<Rent[]> {
  const db = serverClient();
  const out: Rent[] = [];
  const PAGE = 1000;

  for (let offset = 0; offset < 60_000; offset += PAGE) {
    const { data, error } = await db
      .from('apt_rent')
      .select('*')
      .eq('lawd_cd', lawdCd)
      .gte('deal_ym', from)
      .lte('deal_ym', to)
      .order('deal_date', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw wrapDbError('apt_rent 조회 실패', error.message);
    if (!data || data.length === 0) break;

    for (const r of data as Record<string, unknown>[]) {
      out.push({
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
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
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
  opts: { onlyCached?: boolean; concurrency?: number; force?: boolean } = {},
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
    const rents = yms.flatMap((ym) => cached.get(ym) ?? []);
    assertUsable(rents, missing);
    return { rents, mode, fetchedMonths: missing.length, errors };
  }

  const fresh = opts.force ? new Set<string>() : await freshMonths(lawdCd, yms);
  const missing = yms.filter((ym) => !fresh.has(ym));

  if (!opts.onlyCached && missing.length > 0) {
    const results = await fetchRentMonths(lawdCd, missing, { concurrency });
    for (const r of results) if (r.error) errors.push({ ym: r.ym, message: r.error });
    await replaceMonths(lawdCd, results);
  }

  const rents = await selectRents(lawdCd, from, to);
  assertUsable(rents, missing);
  return { rents, mode, fetchedMonths: opts.onlyCached ? 0 : missing.length, errors };
}

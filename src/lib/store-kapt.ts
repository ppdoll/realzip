import type { KaptInfo } from './kapt';
import { fetchAllPaged, serverClient } from './supabase';

/**
 * 단지 정보 저장소.
 *
 * 실거래가와 조인 키가 없어서 **(시군구 + 법정동 + 지번)** 으로 맞춘다.
 * 이름 매칭은 표기가 너무 갈려서 못 쓴다 — 실측 조인율이 지번 79% vs 이름 50~68% 였고,
 * "THESHARP판교퍼스트파크" vs "더샵판교퍼스트파크" 처럼 애초에 문자열로 못 맞추는 경우가 있다.
 * 이름은 지번이 비어 있을 때의 마지막 수단으로만 쓴다.
 */

export type KaptRow = {
  kaptCode: string;
  lawdCd: string;
  umdNm: string;
  jibun: string | null;
  kaptName: string;
  addr: string | null;
  roadAddr: string | null;
  households: number | null;
  dongCnt: number | null;
  totalArea: number | null;
  privArea: number | null;
  useDate: string | null;
  heatNm: string | null;
  hallNm: string | null;
  mgrNm: string | null;
  saleNm: string | null;
  builder: string | null;
  topFloor: number | null;
  elevatorCnt: number | null;
};

function rowToKapt(r: Record<string, unknown>): KaptRow {
  const n = (v: unknown) => (v == null ? null : Number(v));
  const s = (v: unknown) => (v == null ? null : String(v));
  return {
    kaptCode: String(r.kapt_code),
    lawdCd: String(r.lawd_cd),
    umdNm: r.umd_nm == null ? '' : String(r.umd_nm),
    jibun: s(r.jibun),
    kaptName: String(r.kapt_name),
    addr: s(r.addr),
    roadAddr: s(r.road_addr),
    households: n(r.households),
    dongCnt: n(r.dong_cnt),
    totalArea: n(r.total_area),
    privArea: n(r.priv_area),
    useDate: s(r.use_date),
    heatNm: s(r.heat_nm),
    hallNm: s(r.hall_nm),
    mgrNm: s(r.mgr_nm),
    saleNm: s(r.sale_nm),
    builder: s(r.builder),
    topFloor: n(r.top_floor),
    elevatorCnt: n(r.elevator_cnt),
  };
}

/** 스키마 미적용을 알아보기 쉬운 메시지로 바꾼다 */
function wrapDbError(prefix: string, message: string): Error {
  if (/does not exist|schema cache/i.test(message)) {
    return new Error(
      '단지 정보 테이블이 없습니다. src/lib/schema.sql 의 apt_kapt / kapt_ingest_log 부분을 ' +
        'Supabase SQL Editor 에서 실행하거나 npm run db:setup 을 다시 돌려주세요. (' +
        message +
        ')',
    );
  }
  return new Error(prefix + ': ' + message);
}

export async function saveKaptInfos(lawdCd: string, infos: KaptInfo[]): Promise<number> {
  if (infos.length === 0) return 0;
  const db = serverClient();
  const rows = infos.map((i) => ({
    kapt_code: i.kaptCode,
    lawd_cd: lawdCd,
    umd_nm: i.umdNm ?? '',
    jibun: i.jibun,
    kapt_name: i.kaptName,
    addr: i.addr,
    road_addr: i.roadAddr,
    households: i.households,
    dong_cnt: i.dongCnt,
    total_area: i.totalArea,
    priv_area: i.privArea,
    use_date: i.useDate,
    heat_nm: i.heatNm,
    hall_nm: i.hallNm,
    mgr_nm: i.mgrNm,
    sale_nm: i.saleNm,
    builder: i.builder,
    top_floor: i.topFloor,
    elevator_cnt: i.elevatorCnt,
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from('apt_kapt')
      .upsert(rows.slice(i, i + 500), { onConflict: 'kapt_code' });
    if (error) throw wrapDbError('apt_kapt 적재 실패', error.message);
  }

  const { error: logErr } = await db.from('kapt_ingest_log').upsert(
    { lawd_cd: lawdCd, complexes: rows.length, fetched_at: new Date().toISOString() },
    { onConflict: 'lawd_cd' },
  );
  if (logErr) throw wrapDbError('kapt_ingest_log 기록 실패', logErr.message);

  return rows.length;
}

/** 이 시군구를 이미 받아뒀는지 */
export async function kaptIngested(lawdCd: string): Promise<{ complexes: number; at: string } | null> {
  const { data, error } = await serverClient()
    .from('kapt_ingest_log')
    .select('complexes, fetched_at')
    .eq('lawd_cd', lawdCd)
    .maybeSingle();
  if (error) throw wrapDbError('kapt_ingest_log 조회 실패', error.message);
  if (!data) return null;
  return { complexes: Number(data.complexes), at: String(data.fetched_at) };
}

const norm = (s: string) =>
  (s ?? '').replace(/\s+/g, '').replace(/[()[\]·.,\-_/]/g, '').toLowerCase();

/**
 * 실거래가 단지 → 단지 정보 찾기.
 * 지번이 맞는 것을 우선하고, 없으면 같은 법정동에서 이름이 한쪽에 포함되는 것을 본다
 * (동명이 여럿 걸리면 잘못 붙이는 것보다 안 붙이는 게 낫다고 보고 포기한다).
 */
export async function findKapt(
  lawdCd: string,
  umdNm: string,
  jibun: string | null,
  aptNm: string,
): Promise<KaptRow | null> {
  const db = serverClient();

  if (jibun) {
    const { data, error } = await db
      .from('apt_kapt')
      .select('*')
      .eq('lawd_cd', lawdCd)
      .eq('umd_nm', umdNm)
      .eq('jibun', jibun)
      .limit(2);
    if (error) throw wrapDbError('apt_kapt 조회 실패', error.message);
    if (data && data.length === 1) return rowToKapt(data[0] as Record<string, unknown>);
    // 같은 지번에 둘 이상이면 이름으로 가린다
    if (data && data.length > 1) {
      const target = norm(aptNm);
      const hit = (data as Record<string, unknown>[]).find((r) => {
        const n = norm(String(r.kapt_name));
        return n === target || n.includes(target) || target.includes(n);
      });
      if (hit) return rowToKapt(hit);
    }
  }

  // 지번이 없거나 못 찾은 경우: 같은 법정동에서 이름으로
  const { data, error } = await db
    .from('apt_kapt')
    .select('*')
    .eq('lawd_cd', lawdCd)
    .eq('umd_nm', umdNm)
    .limit(200);
  if (error) throw wrapDbError('apt_kapt 조회 실패', error.message);
  if (!data || data.length === 0) return null;

  const target = norm(aptNm);
  const digits = (v: string) => (v.match(/\d+/g) ?? []).join(',');
  const candidates = (data as Record<string, unknown>[]).filter((r) => {
    const n = norm(String(r.kapt_name));
    // 숫자가 둘 다 있으면 같아야 한다 (까치마을 1단지 vs 2단지)
    const dt = digits(target);
    const dn = digits(n);
    if (dt && dn && dt !== dn) return false;
    return n === target || n.includes(target) || target.includes(n);
  });
  return candidates.length === 1 ? rowToKapt(candidates[0]) : null;
}

/** 커버리지 확인용 — 시군구별 적재 현황 */
export async function kaptCoverage(): Promise<{ lawdCd: string; complexes: number; at: string }[]> {
  const rows = await fetchAllPaged<{ lawd_cd: string; complexes: number; fetched_at: string }>(
    () => serverClient().from('kapt_ingest_log').select('lawd_cd, complexes, fetched_at'),
    { label: 'kapt_ingest_log 조회' },
  );
  return rows
    .map((r) => ({ lawdCd: r.lawd_cd, complexes: Number(r.complexes), at: r.fetched_at }))
    .sort((a, b) => a.lawdCd.localeCompare(b.lawdCd));
}

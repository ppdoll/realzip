import type { KaptInfo } from './kapt';
import { matchKapt } from './kapt-match';
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
  aptKind: string | null;
  units60: number | null;
  units85: number | null;
  units135: number | null;
  unitsOver: number | null;
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
    aptKind: s(r.apt_kind),
    units60: n(r.units_60),
    units85: n(r.units_85),
    units135: n(r.units_135),
    unitsOver: n(r.units_over),
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
    apt_kind: i.aptKind,
    units_60: i.units60,
    units_85: i.units85,
    units_135: i.units135,
    units_over: i.unitsOver,
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

/**
 * 실거래가 단지 → 단지 정보 찾기.
 *
 * 매칭 규칙은 `kapt-match.ts` 한 곳에 있다 — 구 분포 계산도 같은 함수를 쓴다.
 * 여기서는 시군구 단위로 후보를 한 번 끌어오고 판단은 그 순수 함수에 맡긴다.
 */
export async function findKapt(
  lawdCd: string,
  umdNm: string,
  jibun: string | null,
  aptNm: string,
): Promise<KaptRow | null> {
  let rows: Record<string, unknown>[];
  try {
    rows = await fetchAllPaged<Record<string, unknown>>(
      () => serverClient().from('apt_kapt').select('*').eq('lawd_cd', lawdCd),
      { label: 'apt_kapt 조회', hardLimit: 5_000 },
    );
  } catch (e) {
    throw wrapDbError('apt_kapt 조회 실패', e instanceof Error ? e.message : String(e));
  }
  if (rows.length === 0) return null;
  return matchKapt(rows.map(rowToKapt), { umdNm, jibun, aptNm });
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

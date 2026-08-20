import { molitServiceKey } from './molit';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  공동주택 단지 정보 (K-apt, 국토교통부)
 * ────────────────────────────────────────────────────────────────────────
 *
 *  두 서비스를 쓴다 (각각 별도 활용신청, 인증키는 실거래가와 같다):
 *    단지 목록  https://www.data.go.kr/data/15057332/openapi.do
 *    기본 정보  https://www.data.go.kr/data/15058453/openapi.do
 *
 *  실거래가 API 와 다른 점 두 가지를 실측으로 확인했다.
 *
 *  1) **응답이 JSON 이다** (실거래가는 XML). 오류도 JSON 으로 온다.
 *  2) **초당 요청제한이 훨씬 엄격하다.** 동시 4개로 던지면 233건 중 184건이
 *     `LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR` 로 죽었다.
 *     순차 + 350ms 간격이면 2.6 req/s 로 안정적이다. 그래서 이 클라이언트는
 *     **동시 실행을 하지 않고** 간격을 두고 순차로만 돈다.
 *
 *  기본 정보는 단지당 1회 호출이라 시군구 하나가 200~250회다. 개발계정 일일
 *  5,000회 기준으로 하루에 시군구 20곳 정도가 한계다. 대신 세대수·준공일 같은
 *  값은 바뀌지 않으므로 한 번 받아두면 다시 받을 일이 거의 없다.
 */

const BASE = 'https://apis.data.go.kr/1613000';
const LIST_OP = 'AptListService3/getSigunguAptList3';
const INFO_OP = 'AptBasisInfoServiceV4/getAphusBassInfoV4';

/** 실측 안전 간격 — 이보다 짧으면 429 가 난다 */
export const KAPT_GAP_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KaptError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = 'KaptError';
  }
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function callJson(path: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ serviceKey: molitServiceKey(), ...params });
  const res = await fetch(`${BASE}/${path}?${qs}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();

  let json: Record<string, any>;
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    // 드물게 XML 오류가 오는 경우
    const msg = /<errMsg>([^<]*)</.exec(text)?.[1] ?? text.slice(0, 120);
    throw new KaptError(`K-apt 응답을 읽지 못했습니다: ${msg}`);
  }

  const fault = json.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (fault) {
    const err = String(fault.errMsg ?? '');
    const code = String(fault.returnReasonCode ?? '?');
    const rate = /PER_SECOND/.test(err);
    const hint =
      code === '30'
        ? ' — 단지 목록/기본 정보는 실거래가와 별도로 활용신청해야 합니다.'
        : code === '22'
          ? ' — 일일 트래픽(개발계정 5,000건)을 초과했습니다.'
          : '';
    throw new KaptError(`K-apt 오류 ${code}: ${err}${hint}`, code, rate);
  }
  return json;
}

/** 429 는 기다리면 풀린다 — 그 외 오류는 바로 올린다 */
async function withRateRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!(e instanceof KaptError) || !e.rateLimited || i === tries - 1) throw e;
      await sleep(1200 * (i + 1));
    }
  }
  throw last;
}

export type KaptListItem = {
  kaptCode: string;
  kaptName: string;
  /** 법정동코드 10자리 */
  bjdCode: string | null;
  sido: string | null;
  sigungu: string | null;
  umdNm: string | null;
};

/** 시군구 1곳의 K-apt 등록 단지 목록 (호출 1회) */
export async function fetchKaptList(lawdCd: string): Promise<KaptListItem[]> {
  const json = (await withRateRetry(() =>
    callJson(LIST_OP, { sigunguCode: lawdCd, pageNo: '1', numOfRows: '2000' }),
  )) as Record<string, any>;

  const body = json.response?.body;
  const raw = Array.isArray(body?.items) ? body.items : (body?.items?.item ?? []);
  const list: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return list
    .map((it) => ({
      kaptCode: toStr(it.kaptCode) ?? '',
      kaptName: toStr(it.kaptName) ?? '',
      bjdCode: toStr(it.bjdCode),
      sido: toStr(it.as1),
      sigungu: toStr(it.as2),
      umdNm: toStr(it.as3),
    }))
    .filter((x) => x.kaptCode && x.kaptName);
}

export type KaptInfo = {
  kaptCode: string;
  kaptName: string;
  addr: string | null;
  roadAddr: string | null;
  /** 주소에서 뽑은 법정동 / 지번 — 실거래가와 조인하는 키 */
  umdNm: string | null;
  jibun: string | null;
  households: number | null;
  dongCnt: number | null;
  totalArea: number | null;
  privArea: number | null;
  /** 건물 종류 (아파트 / 주상복합 …) */
  aptKind: string | null;
  /** 세대 규모 구성 — 전용 60㎡ 이하 / 60~85 / 85~135 / 135 초과 세대수 */
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

/**
 * 주소에서 법정동과 지번을 뽑는다.
 * "서울특별시 강남구 대치동 316 은마" → { umdNm: '대치동', jibun: '316' }
 */
export function parseAddr(addr: string | null): { umdNm: string | null; jibun: string | null } {
  if (!addr) return { umdNm: null, jibun: null };
  const m = /([가-힣0-9]+(?:동|가|읍|면|리))\s+(\d+(?:-\d+)?)/.exec(addr);
  return { umdNm: m?.[1] ?? null, jibun: m?.[2] ?? null };
}

/** 단지 1곳의 기본 정보 (호출 1회) */
export async function fetchKaptInfo(kaptCode: string): Promise<KaptInfo | null> {
  const json = (await withRateRetry(() => callJson(INFO_OP, { kaptCode }))) as Record<string, any>;
  const it = json.response?.body?.item as Record<string, unknown> | undefined;
  if (!it || !toStr(it.kaptCode)) return null;

  const addr = toStr(it.kaptAddr);
  const { umdNm, jibun } = parseAddr(addr);

  return {
    kaptCode: toStr(it.kaptCode)!,
    kaptName: toStr(it.kaptName) ?? '',
    addr,
    roadAddr: toStr(it.doroJuso),
    umdNm,
    jibun,
    households: toNum(it.kaptdaCnt),
    dongCnt: toNum(it.kaptDongCnt),
    totalArea: toNum(it.kaptTarea),
    privArea: toNum(it.privArea),
    aptKind: toStr(it.codeAptNm),
    units60: toNum(it.kaptMparea60),
    units85: toNum(it.kaptMparea85),
    units135: toNum(it.kaptMparea135),
    unitsOver: toNum(it.kaptMparea136),
    useDate: toStr(it.kaptUsedate),
    heatNm: toStr(it.codeHeatNm),
    hallNm: toStr(it.codeHallNm),
    mgrNm: toStr(it.codeMgrNm),
    saleNm: toStr(it.codeSaleNm),
    builder: toStr(it.kaptBcompany),
    topFloor: toNum(it.kaptTopFloor),
    elevatorCnt: toNum(it.kaptdEcntp),
  };
}

/**
 * 목록 → 단지별 기본 정보를 **순차로** 받는다.
 * 동시 실행을 하지 않는 이유는 이 파일 위쪽 주석에 적었다 (초당 제한).
 */
export async function fetchKaptInfos(
  codes: string[],
  opts: { gapMs?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ infos: KaptInfo[]; failed: { kaptCode: string; message: string }[] }> {
  const gap = opts.gapMs ?? KAPT_GAP_MS;
  const infos: KaptInfo[] = [];
  const failed: { kaptCode: string; message: string }[] = [];

  for (let i = 0; i < codes.length; i++) {
    try {
      const info = await fetchKaptInfo(codes[i]);
      if (info) infos.push(info);
      else failed.push({ kaptCode: codes[i], message: '기본 정보가 비어 있습니다' });
    } catch (e) {
      failed.push({
        kaptCode: codes[i],
        message: e instanceof Error ? e.message : String(e),
      });
    }
    opts.onProgress?.(i + 1, codes.length);
    if (i < codes.length - 1) await sleep(gap);
  }

  return { infos, failed };
}

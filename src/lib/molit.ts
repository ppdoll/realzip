import { XMLParser } from 'fast-xml-parser';
import type { Trade } from './types';
import { REGION_BY_CODE } from '@/data/regions';

/**
 * 국토교통부_아파트 매매 실거래가 상세 자료
 *   문서: https://www.data.go.kr/data/15126468/openapi.do
 *   특징: 한 번의 호출로 "시군구 1곳 × 계약년월 1개월"만 조회된다.
 *         따라서 3년 = 36회 호출이 필요하고, 개발계정 일일 트래픽은 10,000건이다.
 */
const ENDPOINT =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev';

const PAGE_SIZE = 1000;

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false, // 숫자 파싱은 직접 한다 (앞자리 0, 콤마 때문에)
});

export class MolitError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryable = false,
    /** 서버가 지정한 대기 시간 (ms). Retry-After 헤더가 있을 때만 채워진다. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'MolitError';
  }
}

/**
 * 인증키를 확인한다. 없으면 즉시 던진다 —
 * 36개월을 돌면서 같은 오류를 36번 모아 "거래 0건"으로 보이게 하면 안 된다.
 */
export function assertServiceKey(): void {
  serviceKey();
}

function serviceKey(): string {
  const raw = process.env.MOLIT_SERVICE_KEY?.trim();
  if (!raw) {
    throw new MolitError(
      'MOLIT_SERVICE_KEY 가 설정되지 않았습니다. .env.local 에 공공데이터포털 일반 인증키(Decoding)를 넣어주세요.',
      'NO_KEY',
    );
  }
  // Encoding 키를 붙여넣은 경우 한 번 디코드해 이중 인코딩을 막는다.
  return /%[0-9A-Fa-f]{2}/.test(raw) ? decodeURIComponent(raw) : raw;
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 응답 태그명은 서비스 버전에 따라 영문(현행 1613000)과 국문(구 openapi.molit.go.kr)이
 * 섞여 있다. 별칭 목록으로 먼저 찾는 쪽을 쓰면 어느 쪽이 와도 파싱된다.
 */
const FIELD: Record<string, string[]> = {
  amount: ['dealAmount', '거래금액'],
  area: ['excluUseAr', '전용면적'],
  year: ['dealYear', '년'],
  month: ['dealMonth', '월'],
  day: ['dealDay', '일'],
  aptNm: ['aptNm', '아파트'],
  umdNm: ['umdNm', '법정동'],
  jibun: ['jibun', '지번'],
  roadNm: ['roadNm', '도로명'],
  buildYear: ['buildYear', '건축년도'],
  floor: ['floor', '층'],
  aptSeq: ['aptSeq', '일련번호'],
  dealingGbn: ['dealingGbn', '거래유형'],
  buyerGbn: ['buyerGbn', '매수자'],
  slerGbn: ['slerGbn', '매도자'],
  cdealType: ['cdealType', '해제여부'],
  rgstDate: ['rgstDate', '등기일자'],
};

function pick(raw: Record<string, unknown>, key: keyof typeof FIELD | string): unknown {
  for (const name of FIELD[key] ?? [key]) {
    const v = raw[name];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

/** 파싱된 원본 항목의 태그명 — 진단용 (`npm run probe -- --raw`) */
export function rawFieldNames(item: Record<string, unknown>): string[] {
  return Object.keys(item);
}

/** API 응답 1건 → Trade. 필수 필드가 없으면 null. */
function normalize(raw: Record<string, unknown>, lawdCd: string): Trade | null {
  const amount = toNum(pick(raw, 'amount'));
  const area = toNum(pick(raw, 'area'));
  const y = toNum(pick(raw, 'year'));
  const m = toNum(pick(raw, 'month'));
  const d = toNum(pick(raw, 'day'));
  if (!amount || !area || !y || !m || !d) return null;

  const aptNm = toStr(pick(raw, 'aptNm')) ?? '(단지명 미상)';
  const umdNm = toStr(pick(raw, 'umdNm')) ?? '';
  const jibun = toStr(pick(raw, 'jibun'));
  const cdealType = toStr(pick(raw, 'cdealType'));

  return {
    // aptSeq(단지 일련번호)가 없으면 법정동+단지명+지번으로 안정적인 대체 키를 만든다.
    aptSeq: toStr(pick(raw, 'aptSeq')) ?? `${lawdCd}-${umdNm}-${aptNm}-${jibun ?? ''}`,
    lawdCd,
    umdNm,
    aptNm,
    jibun,
    roadNm: toStr(pick(raw, 'roadNm')),
    buildYear: toNum(pick(raw, 'buildYear')),
    area,
    floor: toNum(pick(raw, 'floor')),
    dealDate: `${y}-${pad2(m)}-${pad2(d)}`,
    dealYm: `${y}${pad2(m)}`,
    amount,
    dealingGbn: toStr(pick(raw, 'dealingGbn')),
    buyerGbn: toStr(pick(raw, 'buyerGbn')),
    slerGbn: toStr(pick(raw, 'slerGbn')),
    // cdealType 이 O(국문이면 "O"/"해제") 이면 해제된 거래 → 시세 계산에서 제외한다.
    canceled: cdealType === 'O' || cdealType === '해제',
    rgstDate: toStr(pick(raw, 'rgstDate')),
  };
}

type Page = { trades: Trade[]; totalCount: number };

async function fetchPage(
  lawdCd: string,
  dealYmd: string,
  pageNo: number,
  signal?: AbortSignal,
): Promise<Page> {
  const qs = new URLSearchParams({
    serviceKey: serviceKey(),
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    pageNo: String(pageNo),
    numOfRows: String(PAGE_SIZE),
  });

  const res = await fetch(`${ENDPOINT}?${qs}`, {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/xml' },
  });

  if (!res.ok) {
    // 429 는 속도 제한. Retry-After 가 오면 그 값을 그대로 따른다.
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new MolitError(
      `공공데이터포털 HTTP ${res.status}`,
      String(res.status),
      res.status >= 500 || res.status === 429,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }

  const xml = await res.text();
  const doc = parser.parse(xml) as Record<string, any>;

  // 인증키 오류 등은 OpenAPI_ServiceResponse 형태로 온다.
  const fault = doc.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (fault) {
    const code = toStr(fault.returnReasonCode) ?? '?';
    const msg = toStr(fault.errMsg) ?? toStr(fault.returnAuthMsg) ?? '알 수 없는 오류';
    const hint =
      code === '30'
        ? ' — 해당 API 활용신청 여부와, Decoding 키를 넣었는지 확인하세요.'
        : code === '22'
          ? ' — 일일 트래픽(개발계정 10,000건)을 초과했습니다.'
          : '';
    throw new MolitError(
      `공공데이터포털 오류 ${code}: ${msg}${hint}`,
      code,
      code === '22' || code === '10',
    );
  }

  const body = doc.response?.body;
  const header = doc.response?.header;
  const resultCode = toStr(header?.resultCode);
  if (resultCode && resultCode !== '000' && resultCode !== '00') {
    throw new MolitError(
      `실거래가 API 오류 ${resultCode}: ${toStr(header?.resultMsg) ?? ''}`,
      resultCode,
      true,
    );
  }

  const totalCount = toNum(body?.totalCount) ?? 0;
  const itemsNode = body?.items;
  if (!itemsNode || totalCount === 0) return { trades: [], totalCount };

  const rawItems = itemsNode.item ?? [];
  const list: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : [rawItems];

  const trades: Trade[] = [];
  for (const it of list) {
    const t = normalize(it, lawdCd);
    if (t) trades.push(t);
  }
  return { trades, totalCount };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 재시도. 속도 제한(429)과 트래픽 초과(22)는 일반 오류보다 훨씬 길게 기다린다 —
 * 짧은 백오프로는 36개월을 몰아 받을 때 같은 벽에 다시 부딪힌다.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const err = e instanceof MolitError ? e : null;
      const retryable = err ? err.retryable : true;
      if (!retryable || i === tries - 1) throw e;

      const throttled = err?.code === '429' || err?.code === '22';
      const base = throttled ? 1500 : 400;
      const wait = err?.retryAfterMs ?? base * 2 ** i + Math.floor(Math.random() * 300);
      await sleep(wait);
    }
  }
  throw last;
}

async function collectRest(
  lawdCd: string,
  dealYmd: string,
  first: Page,
  signal?: AbortSignal,
): Promise<Trade[]> {
  const out = [...first.trades];
  // 서버가 numOfRows 를 무시하고 잘라 보내는 경우까지 고려해 실제 수신량 기준으로 페이징한다.
  const per = Math.max(1, first.trades.length);
  if (first.totalCount > out.length) {
    const totalPages = Math.ceil(first.totalCount / per);
    for (let p = 2; p <= totalPages && p <= 50; p++) {
      const page = await withRetry(() => fetchPage(lawdCd, dealYmd, p, signal));
      if (page.trades.length === 0) break;
      out.push(...page.trades);
      if (out.length >= first.totalCount) break;
    }
  }
  return out;
}

/**
 * 시군구 1곳의 특정 계약년월 아파트 매매 실거래 전체를 가져온다.
 * 코드 개편 지역(강원 42→51, 전북 45→52)에서 빈 응답이 오면 구 코드로 한 번 더 시도한다.
 */
export async function fetchMonth(
  lawdCd: string,
  dealYmd: string,
  opts: { signal?: AbortSignal; allowLegacyFallback?: boolean } = {},
): Promise<Trade[]> {
  const first = await withRetry(() => fetchPage(lawdCd, dealYmd, 1, opts.signal));

  if (first.totalCount === 0 && opts.allowLegacyFallback !== false) {
    const legacy = REGION_BY_CODE.get(lawdCd)?.legacy;
    if (legacy) {
      const alt = await withRetry(() => fetchPage(legacy, dealYmd, 1, opts.signal));
      if (alt.totalCount > 0) {
        const rest = await collectRest(legacy, dealYmd, alt, opts.signal);
        // 저장은 항상 현행 코드로 통일한다.
        return rest.map((t) => ({ ...t, lawdCd }));
      }
    }
  }

  return collectRest(lawdCd, dealYmd, first, opts.signal);
}

/**
 * 진단용 — 특정 월의 원본 항목(파싱 전 태그 그대로)을 몇 개 돌려준다.
 * 태그명이 바뀌었는지 눈으로 확인할 때 쓴다.
 */
export async function fetchRawSample(
  lawdCd: string,
  dealYmd: string,
  limit = 2,
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams({
    serviceKey: serviceKey(),
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    pageNo: '1',
    numOfRows: String(Math.max(1, limit)),
  });
  const res = await fetch(`${ENDPOINT}?${qs}`, { cache: 'no-store' });
  const doc = parser.parse(await res.text()) as Record<string, any>;
  const items = doc.response?.body?.items?.item ?? [];
  const list = Array.isArray(items) ? items : [items];
  return list.slice(0, limit);
}

/** 동시 실행 수를 제한한 map */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type MonthResult = { ym: string; trades: Trade[]; error?: string };

/** 여러 계약년월을 병렬로(기본 동시 6개) 수집. 실패한 월은 error 로 표시하고 계속 진행한다. */
export async function fetchMonths(
  lawdCd: string,
  yms: string[],
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<MonthResult[]> {
  assertServiceKey(); // 키 문제는 월별 오류로 삼키지 않고 바로 올린다
  return mapLimit(yms, opts.concurrency ?? 6, async (ym) => {
    try {
      return { ym, trades: await fetchMonth(lawdCd, ym, { signal: opts.signal }) };
    } catch (e) {
      return { ym, trades: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
}

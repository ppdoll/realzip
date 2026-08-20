import { XMLParser } from 'fast-xml-parser';
import type { Rent } from './types';
import { MolitError, mapLimit, molitServiceKey } from './molit';

/**
 * 국토교통부_아파트 전월세 실거래가 자료
 *   문서: https://www.data.go.kr/data/15126474/openapi.do
 *
 * 매매(15126468)와 **별도로 활용신청**해야 한다. 같은 인증키를 쓰지만 신청하지 않으면
 * returnReasonCode 30 (등록되지 않은 서비스키)이 돌아온다.
 *
 * 매매 API 와 다른 점:
 *  · 전용면적 태그가 `exclUseAr` — 매매는 `excluUseAr` 로 철자가 다르다
 *  · **aptSeq(단지 일련번호)가 없다** → 단지 매칭은 (법정동+단지명+지번)
 *  · 금액이 보증금 / 월세 두 개. 월세가 0 이면 전세
 */
const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent';

const PAGE_SIZE = 1000;

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
});

/** 응답 태그명 별칭 — 영문 신버전과 국문 구버전을 모두 받아들인다. */
const FIELD: Record<string, string[]> = {
  deposit: ['deposit', '보증금액'],
  monthlyRent: ['monthlyRent', '월세금액'],
  // 매매는 excluUseAr, 전월세는 exclUseAr — 둘 다 둔다
  area: ['exclUseAr', 'excluUseAr', '전용면적'],
  year: ['dealYear', '년'],
  month: ['dealMonth', '월'],
  day: ['dealDay', '일'],
  aptNm: ['aptNm', '아파트'],
  umdNm: ['umdNm', '법정동'],
  jibun: ['jibun', '지번'],
  buildYear: ['buildYear', '건축년도'],
  floor: ['floor', '층'],
  contractTerm: ['contractTerm', '계약기간'],
  contractType: ['contractType', '계약구분'],
  preDeposit: ['preDeposit', '종전계약보증금'],
  preMonthlyRent: ['preMonthlyRent', '종전계약월세'],
  useRRRight: ['useRRRight', '갱신요구권사용'],
};

function pick(raw: Record<string, unknown>, key: string): unknown {
  for (const name of FIELD[key] ?? [key]) {
    const v = raw[name];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
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

/** 응답 1건 → Rent. 필수 필드가 없으면 null. */
export function normalizeRent(raw: Record<string, unknown>, lawdCd: string): Rent | null {
  const deposit = toNum(pick(raw, 'deposit'));
  const area = toNum(pick(raw, 'area'));
  const y = toNum(pick(raw, 'year'));
  const m = toNum(pick(raw, 'month'));
  const d = toNum(pick(raw, 'day'));
  // 월세만 있고 보증금 0 인 계약도 있으므로 deposit 은 0 을 허용한다.
  if (deposit == null || !area || !y || !m || !d) return null;

  return {
    lawdCd,
    umdNm: toStr(pick(raw, 'umdNm')) ?? '',
    aptNm: toStr(pick(raw, 'aptNm')) ?? '(단지명 미상)',
    jibun: toStr(pick(raw, 'jibun')),
    buildYear: toNum(pick(raw, 'buildYear')),
    area,
    floor: toNum(pick(raw, 'floor')),
    dealDate: `${y}-${pad2(m)}-${pad2(d)}`,
    dealYm: `${y}${pad2(m)}`,
    deposit,
    monthlyRent: toNum(pick(raw, 'monthlyRent')) ?? 0,
    contractTerm: toStr(pick(raw, 'contractTerm')),
    contractType: toStr(pick(raw, 'contractType')),
    preDeposit: toNum(pick(raw, 'preDeposit')),
    preMonthlyRent: toNum(pick(raw, 'preMonthlyRent')),
    useRRRight: toStr(pick(raw, 'useRRRight')),
  };
}

type Page = { rents: Rent[]; totalCount: number };

async function fetchPage(
  lawdCd: string,
  dealYmd: string,
  pageNo: number,
  signal?: AbortSignal,
): Promise<Page> {
  const qs = new URLSearchParams({
    serviceKey: molitServiceKey(),
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

  if (!res.ok && res.status !== 403) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new MolitError(
      `공공데이터포털 HTTP ${res.status}`,
      String(res.status),
      res.status >= 500 || res.status === 429,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
    );
  }

  const doc = parser.parse(await res.text()) as Record<string, any>;

  const fault = doc.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (fault) {
    const code = toStr(fault.returnReasonCode) ?? '?';
    const msg = toStr(fault.errMsg) ?? toStr(fault.returnAuthMsg) ?? '알 수 없는 오류';
    const hint =
      code === '30'
        ? ' — 전월세 자료는 매매와 별도로 활용신청해야 합니다.' +
          ' https://www.data.go.kr/data/15126474/openapi.do 에서 신청하세요.'
        : code === '22'
          ? ' — 일일 트래픽(개발계정 10,000건)을 초과했습니다.'
          : '';
    throw new MolitError(
      `전월세 API 오류 ${code}: ${msg}${hint}`,
      code,
      code === '22' || code === '10',
    );
  }

  const body = doc.response?.body;
  const resultCode = toStr(doc.response?.header?.resultCode);
  if (resultCode && resultCode !== '000' && resultCode !== '00') {
    throw new MolitError(
      `전월세 API 오류 ${resultCode}: ${toStr(doc.response?.header?.resultMsg) ?? ''}`,
      resultCode,
      true,
    );
  }

  const totalCount = toNum(body?.totalCount) ?? 0;
  const itemsNode = body?.items;
  if (!itemsNode || totalCount === 0) return { rents: [], totalCount };

  const rawItems = itemsNode.item ?? [];
  const list: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : [rawItems];

  const rents: Rent[] = [];
  for (const it of list) {
    const r = normalizeRent(it, lawdCd);
    if (r) rents.push(r);
  }
  return { rents, totalCount };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const err = e instanceof MolitError ? e : null;
      if (!(err ? err.retryable : true) || i === tries - 1) throw e;
      const throttled = err?.code === '429' || err?.code === '22';
      const base = throttled ? 1500 : 400;
      await sleep(err?.retryAfterMs ?? base * 2 ** i + Math.floor(Math.random() * 300));
    }
  }
  throw last;
}

/** 시군구 1곳의 특정 계약년월 전월세 신고 전체 */
export async function fetchRentMonth(
  lawdCd: string,
  dealYmd: string,
  signal?: AbortSignal,
): Promise<Rent[]> {
  const first = await withRetry(() => fetchPage(lawdCd, dealYmd, 1, signal));
  const out = [...first.rents];
  const per = Math.max(1, first.rents.length);
  if (first.totalCount > out.length) {
    const pages = Math.ceil(first.totalCount / per);
    for (let p = 2; p <= pages && p <= 50; p++) {
      const page = await withRetry(() => fetchPage(lawdCd, dealYmd, p, signal));
      if (page.rents.length === 0) break;
      out.push(...page.rents);
      if (out.length >= first.totalCount) break;
    }
  }
  return out;
}

export type RentMonthResult = { ym: string; rents: Rent[]; error?: string };

/** 여러 계약년월을 병렬로 수집. 실패한 월은 error 로 표시하고 계속 진행한다. */
export async function fetchRentMonths(
  lawdCd: string,
  yms: string[],
  opts: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<RentMonthResult[]> {
  molitServiceKey(); // 키 문제는 월별 오류로 삼키지 않고 바로 올린다
  return mapLimit(yms, opts.concurrency ?? 4, async (ym) => {
    try {
      return { ym, rents: await fetchRentMonth(lawdCd, ym, opts.signal) };
    } catch (e) {
      return { ym, rents: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
}

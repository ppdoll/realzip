import { REGION_BY_CODE } from '@/data/regions';
import { PYEONG, median, quantile } from './stats';
import { recentMonths } from './months';
import { loadRegionIndex, type RegionIndexRow } from './region-index';
import { fetchAllPaged, serverClient } from './supabase';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  지역 페이지 자료 (검색 노출용 정적 페이지)
 * ────────────────────────────────────────────────────────────────────────
 *
 *  이 페이지가 하는 일이 둘이다:
 *   1. "강남구 아파트 실거래가" 같은 검색어를 받는다
 *   2. **단지 페이지로 가는 길을 만든다** — 크롤러는 링크를 따라 걷는다.
 *      사이트맵만 있고 링크가 없으면 발견이 느리고 페이지 사이 관계도 안 읽힌다.
 *
 *  지역 하나의 최근 1년 거래는 평균 5,000행 남짓이라 한 번에 읽어도 된다
 *  (조건 검색은 63개 지역을 동시에 훑어서 DB 함수가 필요했지만 여기는 한 곳이다).
 */

export type RegionComplex = {
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  buildYear: number | null;
  deals: number;
  /** 대표 평형의 중위 거래금액 (만원) */
  price: number;
  area: number;
  pyeong: number;
  pricePerPyeong: number;
};

export type RegionPageData = {
  lawdCd: string;
  name: string;
  label: string;
  sido: string;
  deals12m: number;
  /** 구 전체 평당 만원 — 중위와 가운데 절반 */
  pppMedian: number;
  pppP25: number;
  pppP75: number;
  /** 거래가 많은 단지 (링크용) */
  complexes: RegionComplex[];
  /** 법정동별 거래 수 — 어느 동네가 활발한지 */
  dongs: { umdNm: string; deals: number; pppMedian: number }[];
  longTerm: RegionIndexRow[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function loadRegionPage(lawdCd: string): Promise<RegionPageData | null> {
  const region = REGION_BY_CODE.get(lawdCd);
  if (!region) return null;

  const from12 = recentMonths(12)[0];
  const rows = await fetchAllPaged<{
    apt_seq: string;
    apt_nm: string;
    umd_nm: string | null;
    build_year: number | null;
    area: number;
    amount: number;
  }>(
    () =>
      serverClient()
        .from('apt_trade')
        .select('apt_seq, apt_nm, umd_nm, build_year, area, amount')
        .eq('lawd_cd', lawdCd)
        .eq('canceled', false)
        .gte('deal_ym', from12),
    { label: '지역 거래 조회', hardLimit: 100_000 },
  );
  if (rows.length === 0) return null;

  const ppps = rows.map((r) => Number(r.amount) / (Number(r.area) / PYEONG));

  // 단지별 집계
  type Acc = { nm: string; umd: string; by: number | null; amounts: number[]; areas: number[] };
  const byComplex = new Map<string, Acc>();
  const byDong = new Map<string, { deals: number; ppps: number[] }>();
  for (const r of rows) {
    const c = byComplex.get(r.apt_seq);
    if (c) {
      c.amounts.push(Number(r.amount));
      c.areas.push(Number(r.area));
    } else {
      byComplex.set(r.apt_seq, {
        nm: r.apt_nm,
        umd: r.umd_nm ?? '',
        by: r.build_year == null ? null : Number(r.build_year),
        amounts: [Number(r.amount)],
        areas: [Number(r.area)],
      });
    }
    const d = byDong.get(r.umd_nm ?? '');
    const ppp = Number(r.amount) / (Number(r.area) / PYEONG);
    if (d) {
      d.deals++;
      d.ppps.push(ppp);
    } else {
      byDong.set(r.umd_nm ?? '', { deals: 1, ppps: [ppp] });
    }
  }

  const complexes: RegionComplex[] = [...byComplex.entries()]
    .map(([aptSeq, a]) => {
      const area = round1(a.areas.reduce((s, v) => s + v, 0) / a.areas.length);
      const price = Math.round(median(a.amounts));
      return {
        aptSeq,
        aptNm: a.nm,
        umdNm: a.umd,
        buildYear: a.by,
        deals: a.amounts.length,
        price,
        area,
        pyeong: round1(area / PYEONG),
        pricePerPyeong: Math.round(price / (area / PYEONG)),
      };
    })
    // 거래가 많은 순 — 링크로 걸어 줄 가치가 큰 순서이기도 하다
    .sort((a, b) => b.deals - a.deals);

  return {
    lawdCd,
    name: region.name,
    label: `${region.sido} ${region.name}`,
    sido: region.sido,
    deals12m: rows.length,
    pppMedian: Math.round(median(ppps)),
    pppP25: Math.round(quantile(ppps, 0.25)),
    pppP75: Math.round(quantile(ppps, 0.75)),
    complexes,
    dongs: [...byDong.entries()]
      .map(([umdNm, d]) => ({ umdNm, deals: d.deals, pppMedian: Math.round(median(d.ppps)) }))
      .sort((a, b) => b.deals - a.deals),
    longTerm: await loadRegionIndex(lawdCd).catch(() => []),
  };
}

/** 페이지를 만들 지역 — 실거래를 담아둔 곳만 */
export async function ingestedRegions(): Promise<string[]> {
  const rows = await fetchAllPaged<{ lawd_cd: string }>(
    () => serverClient().from('ingest_log').select('lawd_cd'),
    { label: 'ingest_log 조회' },
  );
  return [...new Set(rows.map((r) => r.lawd_cd))].filter((c) => REGION_BY_CODE.has(c)).sort();
}

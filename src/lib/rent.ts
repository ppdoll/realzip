import { buildRegionIndex, estimate } from './estimate';
import { addMonths } from './months';
import { median } from './stats';
import type { Rent, RentSummary, Trade } from './types';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  전월세 — 단지 매칭과 전세 시세 추정
 * ────────────────────────────────────────────────────────────────────────
 *
 *  전월세 API 에는 **aptSeq 가 없다.** 그래서 매매 쪽 단지와 이어 붙이려면
 *  (법정동 + 단지명 + 지번) 으로 맞춰야 한다. 지번 표기가 어긋나는 경우가 있어
 *  (법정동 + 단지명) 으로 한 번 더 시도한다.
 *
 *  전세 추정은 매매와 같은 기계를 쓴다. 전세 보증금을 Trade.amount 로 옮겨
 *  `buildRegionIndex` + `estimate` 를 그대로 태운다 — 통계적으로 같은 문제이고,
 *  이렇게 하면 지수 환산·이상치 제거·면적/층 가중이 공짜로 따라온다.
 *
 *  **월세 계약은 전세 추정에 넣지 않는다.** 전월세전환율로 환산할 수는 있지만
 *  그 비율 자체가 시기·지역마다 달라서 오차를 키운다. 월세는 따로 집계만 한다.
 *
 *  **신규/갱신은 나누지 않는다.** 갱신 계약이 옛 시세를 물고 있을 것 같아 확인해 봤지만
 *  (은마 84㎡ 최근 1년 217건) 사분위 폭이 신규 1.17배 · 갱신 1.18배로 사실상 같았고
 *  중위값 차이도 4.7% 뿐이었다. 절반을 버릴 만한 이득이 없다.
 *  전세 보증금의 큰 편차는 층·동·수리상태에서 오는 실제 분산이다 — 예측구간이 넓은 건
 *  모델이 약해서가 아니라 데이터가 그렇게 생겼기 때문이고, 그래서 모델을 거치지 않은
 *  `recentNewMedian`(최근 1년 신규 계약 중위값)을 나란히 보여준다.
 */

/** 비교용 정규화 — 공백 제거 (단지명 표기가 데이터셋 간 미묘하게 다르다) */
function norm(s: string): string {
  return s.replace(/\s+/g, '');
}

export type ComplexRef = {
  umdNm: string;
  aptNm: string;
  jibun: string | null;
};

/**
 * 단지에 해당하는 전월세만 골라낸다.
 * 지번까지 맞는 것을 먼저 찾고, 하나도 없으면 법정동+단지명으로 넓힌다.
 */
export function filterComplexRents(rents: Rent[], target: ComplexRef): Rent[] {
  const umd = norm(target.umdNm);
  const apt = norm(target.aptNm);
  const jibun = target.jibun ? norm(target.jibun) : null;

  const sameName = rents.filter((r) => norm(r.umdNm) === umd && norm(r.aptNm) === apt);
  if (jibun) {
    const exact = sameName.filter((r) => r.jibun && norm(r.jibun) === jibun);
    if (exact.length > 0) return exact;
  }
  return sameName;
}

/** 전세 계약을 매매 추정기가 먹을 수 있는 Trade 모양으로 옮긴다. */
export function jeonseAsTrades(rents: Rent[]): Trade[] {
  return rents
    .filter((r) => r.monthlyRent === 0 && r.deposit > 0 && r.area > 0)
    .map((r) => ({
      // 지수의 unit 키가 단지+평형으로 묶이도록 이름 기반 식별자를 만든다
      aptSeq: `${r.lawdCd}|${norm(r.umdNm)}|${norm(r.aptNm)}|${r.jibun ? norm(r.jibun) : ''}`,
      lawdCd: r.lawdCd,
      umdNm: r.umdNm,
      aptNm: r.aptNm,
      jibun: r.jibun,
      roadNm: null,
      buildYear: r.buildYear,
      area: r.area,
      floor: r.floor,
      dealDate: r.dealDate,
      dealYm: r.dealYm,
      amount: r.deposit,
      // 전월세에는 중개/직거래 구분이 없다 — 가중치 감점 대상이 아니다
      dealingGbn: null,
      buyerGbn: null,
      slerGbn: null,
      canceled: false,
      rgstDate: null,
    }));
}

export type RentSummaryInput = {
  /** 시군구 전체 전월세 (전세 지수 산출용) */
  regionRents: Rent[];
  /** 대상 단지 전월세 */
  complexRents: Rent[];
  /** 조회 창 */
  from: string;
  to: string;
  /** 목표 전용면적 (m²) */
  area: number;
  floor?: number | null;
  /** 같은 면적의 매매 추정가 (만원). 전세가율 계산에 쓴다 */
  salePrice?: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function summarizeRent(input: RentSummaryInput): RentSummary | null {
  const { regionRents, complexRents, from, to, area } = input;

  const sameArea = complexRents.filter((r) => Math.abs(r.area - area) < 1.5);
  const jeonse = sameArea.filter((r) => r.monthlyRent === 0);
  const monthly = sameArea.filter((r) => r.monthlyRent > 0);

  const byDateDesc = <T extends { dealDate: string }>(xs: T[]) =>
    [...xs].sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1));

  const lastJeonseRow = byDateDesc(jeonse)[0];
  const lastMonthlyRow = byDateDesc(monthly)[0];

  // 최근 1년 신규 전세의 중위 보증금 — 모델과 무관한 참고값
  const cutoff = addMonths(to, -11);
  const cutoffDate = `${cutoff.slice(0, 4)}-${cutoff.slice(4, 6)}-01`;
  const recentNew = jeonse.filter(
    (r) => r.dealDate >= cutoffDate && (r.contractType ?? '').includes('신규'),
  );

  // 전세 지수는 시군구 전체 전세로 만들고, 추정은 이 단지 전세로 한다.
  const regionJeonse = jeonseAsTrades(regionRents);
  const complexJeonse = jeonseAsTrades(complexRents);

  let est: ReturnType<typeof estimate> = null;
  let asOf = `${to.slice(0, 4)}-${to.slice(4, 6)}`;

  if (complexJeonse.length > 0 && regionJeonse.length > 0) {
    const index = buildRegionIndex(regionJeonse, from, to);
    est = estimate({
      regionTrades: regionJeonse,
      complexTrades: complexJeonse,
      index,
      area,
      floor: input.floor ?? null,
    });
    if (est) asOf = est.asOf;
  }

  const jeonsePrice = est?.price ?? null;
  const salePrice = input.salePrice ?? null;

  return {
    asOf,
    area: round1(area),
    jeonsePrice,
    jeonseLow: est?.low ?? null,
    jeonseHigh: est?.high ?? null,
    jeonseConfidence: est?.confidence ?? null,
    jeonseSamples: est?.sampleSize ?? 0,
    jeonseRatioPct:
      jeonsePrice != null && salePrice != null && salePrice > 0
        ? round1((jeonsePrice / salePrice) * 100)
        : null,
    lastJeonse: lastJeonseRow
      ? {
          dealDate: lastJeonseRow.dealDate,
          deposit: lastJeonseRow.deposit,
          floor: lastJeonseRow.floor,
        }
      : null,
    lastMonthly: lastMonthlyRow
      ? {
          dealDate: lastMonthlyRow.dealDate,
          deposit: lastMonthlyRow.deposit,
          monthlyRent: lastMonthlyRow.monthlyRent,
          floor: lastMonthlyRow.floor,
        }
      : null,
    jeonseCount: jeonse.length,
    monthlyCount: monthly.length,
    recentNewMedian: recentNew.length > 0 ? Math.round(median(recentNew.map((r) => r.deposit))) : null,
    recentNewCount: recentNew.length,
  };
}

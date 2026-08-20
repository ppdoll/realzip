import { PYEONG, median } from './stats';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  비슷한 가격대의 서울 아파트 찾기
 * ────────────────────────────────────────────────────────────────────────
 *
 *  "이 돈으로 서울 어디를 살 수 있나"에 답한다. 서울 25개 구를 전부 뒤져야 하는데
 *  단지마다 `estimate()` 를 돌리면 수천 번 회귀를 돌려야 해서 불가능하다.
 *  그래서 **후보를 SQL 에서 먼저 좁힌다** — 면적 ±7%, 금액 ±15%, 최근 12개월.
 *  실측으로 474행(단지·평형 100조합) 정도만 남아서 나머지는 메모리에서 처리한다.
 *
 *  대표가격은 회귀가 아니라 **최근 거래의 중위값**이다. 단지 하나를 정밀 추정하는
 *  화면과 달리 여기서는 "비슷한 값끼리 모아 보여주기"가 목적이라 중위값이 충분하고,
 *  같은 기준으로 계산되므로 서로 비교하기에도 낫다.
 */

/** 면적 허용 범위 (예: 84㎡ 기준 78~90㎡) */
export const AREA_TOLERANCE = 0.07;
/** 금액 허용 범위 — 후보를 넉넉히 받고 순위에서 걸러낸다 */
export const PRICE_TOLERANCE = 0.15;
/** 대표가격을 낼 최소 거래 수 */
const MIN_DEALS = 2;

export type CandidateTrade = {
  lawdCd: string;
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  buildYear: number | null;
  area: number;
  floor: number | null;
  amount: number;
  dealDate: string;
};

export type SimilarComplex = {
  lawdCd: string;
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  buildYear: number | null;
  /** 대표 전용면적 (m², 소수 1자리) */
  area: number;
  /** 최근 12개월 중위 거래금액 (만원) */
  price: number;
  /** 전용 평단가 (만원/평) */
  pricePerPyeong: number;
  /** 최근 12개월 거래 건수 */
  dealCount: number;
  lastDealDate: string;
  /** 기준가 대비 차이 (%) */
  diffPct: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type FindSimilarInput = {
  candidates: CandidateTrade[];
  /** 기준 전용면적 (m²) */
  area: number;
  /** 기준 금액 (만원) */
  price: number;
  /** 제외할 단지 (지금 보고 있는 것) */
  excludeAptSeq: string;
  limit?: number;
};

/**
 * 후보 거래를 (단지 × 평형) 으로 묶어 대표가격을 내고, 기준가에 가까운 순으로 정렬한다.
 *
 * 같은 단지에서 여러 평형이 걸릴 수 있는데, 가장 가까운 하나만 남긴다 —
 * 목록에 같은 단지가 두 번 나오면 추천으로서 쓸모가 떨어진다.
 */
export function findSimilar(input: FindSimilarInput): SimilarComplex[] {
  const { candidates, area, price, excludeAptSeq } = input;
  const limit = input.limit ?? 12;

  const groups = new Map<string, CandidateTrade[]>();
  for (const c of candidates) {
    if (c.aptSeq === excludeAptSeq) continue;
    const key = `${c.aptSeq}|${round1(c.area)}`;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  const all: SimilarComplex[] = [];
  for (const [, list] of groups) {
    if (list.length < MIN_DEALS) continue;
    const rep = list.reduce((a, b) => (a.dealDate > b.dealDate ? a : b));
    const med = median(list.map((c) => c.amount));
    const repArea = round1(rep.area);
    all.push({
      lawdCd: rep.lawdCd,
      aptSeq: rep.aptSeq,
      aptNm: rep.aptNm,
      umdNm: rep.umdNm,
      buildYear: rep.buildYear,
      area: repArea,
      price: Math.round(med / 10) * 10,
      pricePerPyeong: round1((med / repArea) * PYEONG),
      dealCount: list.length,
      lastDealDate: rep.dealDate,
      diffPct: round1(((med - price) / price) * 100),
    });
  }

  // 같은 단지는 기준 면적에 가장 가까운 평형 하나만
  const bestPerComplex = new Map<string, SimilarComplex>();
  for (const s of all) {
    const cur = bestPerComplex.get(s.aptSeq);
    if (!cur || Math.abs(s.area - area) < Math.abs(cur.area - area)) {
      bestPerComplex.set(s.aptSeq, s);
    }
  }

  return [...bestPerComplex.values()]
    .sort((a, b) => Math.abs(a.diffPct) - Math.abs(b.diffPct))
    .slice(0, limit);
}

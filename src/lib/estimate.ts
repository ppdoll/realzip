import type { Complex, Estimate, IndexPoint, Trade } from './types';
import { addMonths, dateToYm, monthDiff, monthRange } from './months';
import {
  PYEONG,
  Z80,
  effectiveN,
  mad,
  median,
  loessLinear,
  trendSlope,
  trimmedMedian,
  weightedMedian,
  wls,
} from './stats';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  예상 실거래가 추정
 * ────────────────────────────────────────────────────────────────────────
 *
 *  실거래 데이터로 "지금 팔면 얼마"를 추정할 때의 진짜 문제는 세 가지다.
 *
 *   1) 단지별 거래가 드물다. 84㎡ 한 타입이 1년에 2~3건인 단지가 흔하다.
 *      → 3년치를 다 쓰되, 오래된 거래는 그 사이의 시장 변동만큼 "현재가로 환산"한다.
 *   2) 시군구 중위가격을 그냥 쓰면 구성 변화(어느 동/어느 평형이 거래됐는지)에
 *      휘둘린다. → 같은 단지·같은 평형(unit) 안에서의 상대 변동만 뽑아 지수를 만든다.
 *      (패널 고정효과 방식)
 *   3) 직거래·가족간 거래·증여성 거래가 시세와 크게 어긋난다.
 *      → MAD 기준 이상치 제거 + 직거래 가중치 하향.
 *
 *  최종 추정은 "지수로 현재가 환산 → 면적/층 유사도 가중 WLS(로그 평단가)" 이고,
 *  표본이 부족하면 가중 중위수로 자동 강등된다.
 */

/** 지수 산출에 쓸 단위(같은 단지 + 같은 평형) 키 */
function unitKey(t: Trade): string {
  return `${t.aptSeq}|${Math.round(t.area)}`;
}

/** 만원/m² */
function ppm2(t: Trade): number {
  return t.amount / t.area;
}

function isUsable(t: Trade): boolean {
  return !t.canceled && t.amount > 0 && t.area > 0;
}

/**
 * 시군구 월별 가격지수 (최신월 = 100).
 *
 * 같은 unit(단지+평형)이 여러 번 거래된 기록만 써서, 로그 평단가를
 * "unit 효과 + 월 효과"로 분해한다(2원 고정효과). 교대 중위수로 풀기 때문에
 * 이상거래에 강건하고, 어느 동네가 거래됐는지에 따라 중위가격이 튀는
 * 구성 변화 문제가 사라진다.
 *
 * 거래가 1건뿐인 unit 은 월 효과에 0 만 보태 추세를 눌러버리므로 제외한다.
 * 마무리 평활은 이동평균이 아니라 국소선형(LOESS)이다 — 끝단 편향이 없어야
 * "최근 1년 변동률"이 맞는다.
 */
export function buildRegionIndex(trades: Trade[], from: string, to: string): IndexPoint[] {
  const months = monthRange(from, to);
  const monthIdx = new Map(months.map((ym, i) => [ym, i]));
  const usable = trades.filter(isUsable).filter((t) => monthIdx.has(t.dealYm));

  // 표시용: 월별 원시 절사중위 평단가 (구성 변화가 그대로 보이는 실측값)
  const rawByMonth = new Map<string, number[]>();
  for (const t of usable) {
    const arr = rawByMonth.get(t.dealYm);
    if (arr) arr.push(ppm2(t));
    else rawByMonth.set(t.dealYm, [ppm2(t)]);
  }

  type Obs = { u: string; m: number; y: number };
  const allObs: Obs[] = usable.map((t) => ({
    u: unitKey(t),
    m: monthIdx.get(t.dealYm)!,
    y: Math.log(ppm2(t)),
  }));

  // unit 내부 이상치 제거 (증여성·가족간 거래 등)
  const byUnitAll = new Map<string, Obs[]>();
  for (const o of allObs) {
    const arr = byUnitAll.get(o.u);
    if (arr) arr.push(o);
    else byUnitAll.set(o.u, [o]);
  }
  const obs: Obs[] = [];
  for (const [, list] of byUnitAll) {
    if (list.length < 4) {
      obs.push(...list);
      continue;
    }
    const med = median(list.map((o) => o.y));
    const dev = mad(list.map((o) => o.y));
    obs.push(...(dev > 0 ? list.filter((o) => Math.abs(o.y - med) / dev <= 3) : list));
  }

  // 시간 정보를 담은 unit = 같은 평형이 2번 이상 거래된 곳
  const byUnit = new Map<string, Obs[]>();
  for (const o of obs) {
    const arr = byUnit.get(o.u);
    if (arr) arr.push(o);
    else byUnit.set(o.u, [o]);
  }
  const panel = obs.filter((o) => (byUnit.get(o.u)?.length ?? 0) >= 2);
  const panelUnits = new Map<string, Obs[]>();
  for (const o of panel) {
    const arr = panelUnits.get(o.u);
    if (arr) arr.push(o);
    else panelUnits.set(o.u, [o]);
  }

  let rawEffect: (number | null)[];

  if (panel.length >= months.length * 2 && panelUnits.size >= 8) {
    // ── 2원 고정효과: 교대 중위수로 unit 효과와 월 효과를 번갈아 갱신 ──
    const byMonth: Obs[][] = Array.from({ length: months.length }, () => []);
    for (const o of panel) byMonth[o.m].push(o);

    const monthEff = new Array<number>(months.length).fill(0);
    const unitEff = new Map<string, number>();

    for (let iter = 0; iter < 15; iter++) {
      for (const [u, list] of panelUnits) {
        unitEff.set(u, median(list.map((o) => o.y - monthEff[o.m])));
      }
      for (let m = 0; m < months.length; m++) {
        const list = byMonth[m];
        if (list.length === 0) continue;
        monthEff[m] = median(list.map((o) => o.y - (unitEff.get(o.u) ?? 0)));
      }
    }
    rawEffect = monthEff.map((v, m) => (byMonth[m].length > 0 && Number.isFinite(v) ? v : null));
  } else {
    // 표본이 너무 적으면 단순 월별 중위 평단가로 물러선다.
    rawEffect = months.map((ym) => {
      const src = rawByMonth.get(ym);
      return src && src.length >= 2 ? Math.log(trimmedMedian(src, 0.15)) : null;
    });
  }

  // 국소선형 평활 → 끝단 편향 없이 잡음만 제거
  const smooth = loessLinear(rawEffect, 3);
  const anchor = [...smooth].reverse().find((v) => v != null) ?? 0;

  return months.map((ym, i) => {
    const rawList = rawByMonth.get(ym) ?? [];
    const s = smooth[i];
    return {
      ym,
      index: s != null ? Math.exp(s - anchor) * 100 : 100,
      medianPricePerPyeong:
        rawList.length > 0 ? round1(trimmedMedian(rawList, 0.15) * PYEONG) : null,
      count: rawList.length,
    };
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 만원 단위 금액을 10만원 단위로 반올림 */
function roundAmount(n: number): number {
  return Math.round(n / 10) * 10;
}

// ────────────────────────────────────────────────────────────────────────

type Sample = {
  ym: string;
  monthsAgo: number;
  area: number;
  floor: number | null;
  ppm2: number;
  /** 지수로 현재 시점 가격으로 환산한 평단가 */
  adj: number;
  direct: boolean;
  amount: number;
  dealDate: string;
};

export type EstimateInput = {
  /** 시군구 전체 거래 (지수 산출용) */
  regionTrades: Trade[];
  /** 대상 단지 거래 */
  complexTrades: Trade[];
  index: IndexPoint[];
  /** 목표 전용면적 (m²) */
  area: number;
  /** 목표 층 (모르면 null → 중층 가정) */
  floor?: number | null;
  /** 기준월 YYYYMM (기본: 지수의 마지막 월) */
  asOf?: string;
};

export function estimate(input: EstimateInput): Estimate | null {
  const { regionTrades, complexTrades, index, area } = input;
  const asOf = input.asOf ?? index[index.length - 1]?.ym;
  if (!asOf) return null;

  const idxMap = new Map(index.map((p) => [p.ym, p.index / 100]));
  const notes: string[] = [];

  const all = complexTrades.filter((t) => t.amount > 0 && t.area > 0);
  const canceledCount = all.filter((t) => t.canceled).length;
  const pool = all.filter(isUsable);
  if (pool.length === 0) return null;
  if (canceledCount > 0) notes.push(`해제 신고된 거래 ${canceledCount}건은 제외했습니다.`);

  // 목표 층: 미지정이면 해당 평형의 중간층으로 가정
  const sameAreaFloors = pool
    .filter((t) => Math.abs(t.area - area) < 1.5 && t.floor != null)
    .map((t) => t.floor!);
  const targetFloor =
    input.floor ?? (sameAreaFloors.length > 0 ? Math.round(median(sameAreaFloors)) : null);

  let samples: Sample[] = pool.map((t) => {
    const idx = idxMap.get(t.dealYm) ?? 1;
    const p = ppm2(t);
    return {
      ym: t.dealYm,
      monthsAgo: Math.max(0, monthDiff(t.dealYm, asOf)),
      area: t.area,
      floor: t.floor,
      ppm2: p,
      adj: idx > 0 ? p / idx : p,
      direct: (t.dealingGbn ?? '').includes('직거래'),
      amount: t.amount,
      dealDate: t.dealDate,
    };
  });

  // 이상치 제거 (로그 평단가 기준). 표본 8건 이상일 때만 적용한다.
  if (samples.length >= 8) {
    const logs = samples.map((s) => Math.log(s.adj));
    const m = median(logs);
    const d = mad(logs);
    if (d > 0) {
      const before = samples.length;
      samples = samples.filter((s) => Math.abs(Math.log(s.adj) - m) / d <= 2.5);
      const removed = before - samples.length;
      if (removed > 0) notes.push(`시세와 크게 벗어난 거래 ${removed}건을 제외했습니다.`);
    }
  }

  // 가중치: 최근성(반감기 12개월) × 면적 유사도 × 층 유사도 × 직거래 감점
  const weights = samples.map((s) => {
    const recency = Math.max(0.02, 0.5 ** (s.monthsAgo / 12));
    const areaSim = Math.exp(-0.5 * (Math.log(s.area / area) / 0.1) ** 2);
    const floorSim =
      targetFloor != null && s.floor != null
        ? Math.exp(-0.5 * ((s.floor - targetFloor) / 10) ** 2)
        : 1;
    const directPenalty = s.direct ? 0.35 : 1;
    return Math.max(1e-6, recency * areaSim * floorSim * directPenalty);
  });

  const effN = effectiveN(weights);
  const directShare = samples.filter((s) => s.direct).length / samples.length;
  if (directShare >= 0.3) {
    notes.push(`직거래 비중이 ${Math.round(directShare * 100)}%로 높아 신뢰도가 낮습니다.`);
  }

  // ── 설계행렬: 예측점에서 0이 되도록 중심화 → 절편이 곧 추정값 ──
  const y = samples.map((s) => Math.log(s.adj));
  const areaTerm = samples.map((s) => Math.log(s.area / area));
  const floorTerm = samples.map((s) =>
    targetFloor != null && s.floor != null ? (s.floor - targetFloor) / 10 : 0,
  );

  const cols: number[][] = [samples.map(() => 1)];
  const hasAreaSpread = spread(areaTerm) > 0.02;
  const hasFloorSpread = targetFloor != null && spread(floorTerm) > 0.2;
  // 계수 1개당 유효표본 4개 이상을 요구한다 (과적합 방지)
  if (hasAreaSpread && effN >= 8) cols.push(areaTerm);
  if (hasFloorSpread && effN >= 12) cols.push(floorTerm);

  const X = samples.map((_, i) => cols.map((c) => c[i]));
  const fit = effN >= 3 ? wls(X, y, weights) : null;

  let logHat: number;
  let sigma: number;
  let method: Estimate['method'];

  if (fit && Number.isFinite(fit.beta[0])) {
    logHat = fit.beta[0];
    sigma = fit.sigma;
    method = 'hedonic';
  } else {
    // 표본이 아주 적을 때: 가중 중위수 (면적당 가격 그대로)
    logHat = Math.log(weightedMedian(samples.map((s) => s.adj), weights));
    const logs = samples.map((s) => Math.log(s.adj));
    sigma = samples.length >= 3 ? Math.max(mad(logs), 0.02) : 0.08;
    method = samples.length === 1 ? 'region-index' : 'weighted-median';
    notes.push('거래 표본이 적어 단순 가중 중위수로 추정했습니다.');
  }

  if (!Number.isFinite(logHat)) return null;

  const ppm2Hat = Math.exp(logHat);
  const price = ppm2Hat * area;

  // 80% 예측구간: 다음 거래 1건이 들어올 범위. 표본이 적으면 넓어진다.
  const sePred = Math.max(0.015, sigma) * Math.sqrt(1 + 1 / Math.max(1, effN)) * (1 + 1.5 / Math.max(1, effN));
  const low = price * Math.exp(-Z80 * sePred);
  const high = price * Math.exp(Z80 * sePred);

  // ── 추세 ──
  const regionYoyPct = yoyFromIndex(index, asOf);
  const complexYoyPct = complexYoy(samples, weights);

  // 3개월 후: 지역 지수의 최근 12개월 로그추세를 연장 (월 ±1.5% 로 제한)
  const logIdx = index
    .slice(-12)
    .map((p) => Math.log(Math.max(1e-6, p.index)));
  const slope = Math.max(-0.015, Math.min(0.015, trendSlope(logIdx)));
  const forecast3m = price * Math.exp(3 * slope);

  // ── 최근 동일 평형 실거래 ──
  const sameArea = pool
    .filter((t) => Math.abs(t.area - area) < 1.5)
    .sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1));
  const lastDeal = sameArea[0] ?? [...pool].sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1))[0];
  const monthsSinceLast = lastDeal ? monthDiff(dateToYm(lastDeal.dealDate), asOf) : 999;

  if (monthsSinceLast >= 12) {
    notes.push(
      `이 평형의 최근 실거래가 ${monthsSinceLast}개월 전이라 지역 시세 흐름으로 보정한 값입니다.`,
    );
  }
  if (regionTrades.length < 200) {
    notes.push('지역 전체 거래량이 적어 가격지수 자체의 오차가 큽니다.');
  }

  const confidence: Estimate['confidence'] =
    effN >= 12 && monthsSinceLast <= 6
      ? 'high'
      : effN >= 5 && monthsSinceLast <= 18
        ? 'medium'
        : 'low';

  return {
    asOf: `${asOf.slice(0, 4)}-${asOf.slice(4, 6)}`,
    area: round1(area),
    floor: targetFloor,
    price: roundAmount(price),
    low: roundAmount(low),
    high: roundAmount(high),
    pricePerPyeong: round1(ppm2Hat * PYEONG),
    forecast3m: roundAmount(forecast3m),
    sampleSize: Math.round(effN * 10) / 10,
    lastDealDate: lastDeal?.dealDate ?? null,
    lastDealAmount: lastDeal?.amount ?? null,
    confidence,
    method,
    regionYoyPct: round1(regionYoyPct),
    complexYoyPct: complexYoyPct == null ? null : round1(complexYoyPct),
    notes,
  };
}

function spread(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, v) => a + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length);
}

function yoyFromIndex(index: IndexPoint[], asOf: string): number {
  const at = (ym: string) => index.find((p) => p.ym === ym)?.index;
  const now = at(asOf) ?? index[index.length - 1]?.index;
  const prev = at(addMonths(asOf, -12));
  if (!now || !prev || prev <= 0) return 0;
  return (now / prev - 1) * 100;
}

/** 단지 자체의 연간 변동률 — 지수 보정 전 로그 평단가 추세로 계산 */
function complexYoy(samples: Sample[], weights: number[]): number | null {
  if (samples.length < 8) return null;
  const span = Math.max(...samples.map((s) => s.monthsAgo)) - Math.min(...samples.map((s) => s.monthsAgo));
  if (span < 12) return null;
  // 월별 가중 평균 로그 평단가 → 추세 기울기
  const byMonth = new Map<number, { s: number; w: number }>();
  samples.forEach((s, i) => {
    const cur = byMonth.get(s.monthsAgo) ?? { s: 0, w: 0 };
    cur.s += Math.log(s.ppm2) * weights[i];
    cur.w += weights[i];
    byMonth.set(s.monthsAgo, cur);
  });
  const pts = [...byMonth.entries()]
    .sort((a, b) => b[0] - a[0]) // 과거 → 최근
    .map(([, v]) => v.s / v.w);
  if (pts.length < 5) return null;
  const slope = trendSlope(pts); // 관측 지점 1칸당 변화 (등간격 아님 → 근사)
  const perMonth = slope * ((pts.length - 1) / Math.max(1, span));
  return (Math.exp(perMonth * 12) - 1) * 100;
}

// ────────────────────────────────────────────────────────────────────────

/** 시군구 거래 목록 → 단지 요약 목록 (거래 많은 순) */
export function summarizeComplexes(trades: Trade[]): Complex[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!isUsable(t)) continue;
    const arr = groups.get(t.aptSeq);
    if (arr) arr.push(t);
    else groups.set(t.aptSeq, [t]);
  }

  const out: Complex[] = [];
  for (const [aptSeq, list] of groups) {
    const sorted = [...list].sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1));
    const latest = sorted[0];
    const recent = sorted.slice(0, 5);
    const areas = [...new Set(list.map((t) => round1(t.area)))].sort((a, b) => a - b);
    out.push({
      aptSeq,
      aptNm: latest.aptNm,
      umdNm: latest.umdNm,
      lawdCd: latest.lawdCd,
      buildYear: latest.buildYear,
      dealCount: list.length,
      lastDealDate: latest.dealDate,
      areas,
      recentPricePerPyeong: round1(median(recent.map((t) => ppm2(t))) * PYEONG),
    });
  }
  return out.sort((a, b) => b.dealCount - a.dealCount);
}

/** 특정 단지의 평형(전용면적) 목록 — 거래 건수 순 */
export function areaOptions(trades: Trade[]): { area: number; count: number; label: string }[] {
  const map = new Map<number, number>();
  for (const t of trades) {
    if (!isUsable(t)) continue;
    const key = round1(t.area);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([area, count]) => ({
      area,
      count,
      label: `${area}㎡ (${Math.round(area / PYEONG)}평)`,
    }))
    .sort((a, b) => b.count - a.count || a.area - b.area);
}

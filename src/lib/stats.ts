/** 통계 유틸 — 외부 의존성 없이 필요한 것만 직접 구현한다. */

export const PYEONG = 3.305785; // 1평 = 3.305785 m²

export function m2ToPyeong(m2: number): number {
  return m2 / PYEONG;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** 상·하위 각 `p` 비율을 잘라낸 절사평균의 중위수 버전 — 이상거래에 강건하다. */
export function trimmedMedian(xs: number[], p = 0.1): number {
  if (xs.length < 5) return median(xs);
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * p);
  return median(s.slice(k, s.length - k));
}

/** Median Absolute Deviation (정규분포 기준 표준편차 스케일로 보정) */
export function mad(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/**
 * MAD 기준 이상치 인덱스 집합.
 * 직거래·증여성 거래·가족간 거래처럼 시세와 동떨어진 신고가를 걸러낸다.
 */
export function outlierMask(xs: number[], z = 3): boolean[] {
  if (xs.length < 5) return xs.map(() => false);
  const m = median(xs);
  const d = mad(xs);
  if (!(d > 0)) return xs.map(() => false);
  return xs.map((x) => Math.abs(x - m) / d > z);
}

export function weightedMean(xs: number[], ws: number[]): number {
  let sw = 0;
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += xs[i] * ws[i];
    sw += ws[i];
  }
  return sw > 0 ? s / sw : NaN;
}

export function weightedMedian(xs: number[], ws: number[]): number {
  const pairs = xs.map((x, i) => [x, ws[i]] as const).sort((a, b) => a[0] - b[0]);
  const total = pairs.reduce((acc, [, w]) => acc + w, 0);
  if (!(total > 0)) return NaN;
  let acc = 0;
  for (const [x, w] of pairs) {
    acc += w;
    if (acc >= total / 2) return x;
  }
  return pairs[pairs.length - 1][0];
}

/**
 * 가중 최소제곱 (Weighted Least Squares).
 * 정규방정식 XᵗWX β = XᵗWy 를 가우스 소거법으로 푼다.
 * 표본이 적을 때 발산하지 않도록 아주 작은 릿지 항을 더한다.
 *
 * @returns 계수 배열, 또는 해가 불안정하면 null
 */
export function wls(
  X: number[][],
  y: number[],
  w: number[],
  ridge = 1e-8,
): { beta: number[]; sigma: number; dof: number } | null {
  const n = X.length;
  if (n === 0) return null;
  const k = X[0].length;
  if (n <= k) return null;

  // XᵗWX (k×k), XᵗWy (k)
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const wi = w[i];
    for (let r = 0; r < k; r++) {
      b[r] += wi * X[i][r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += wi * X[i][r] * X[i][c];
    }
  }
  for (let r = 0; r < k; r++) A[r][r] += ridge;

  // 부분 피벗 가우스 소거법
  const M = A.map((row, r) => [...row, b[r]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null; // 특이행렬 → 설계행렬이 축퇴됨
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= k; c++) M[col][c] /= d;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = col; c <= k; c++) M[r][c] -= f * M[col][c];
    }
  }
  const beta = M.map((row) => row[k]);
  if (beta.some((v) => !Number.isFinite(v))) return null;

  // 가중 잔차분산
  let sse = 0;
  let sw = 0;
  for (let i = 0; i < n; i++) {
    let fit = 0;
    for (let c = 0; c < k; c++) fit += X[i][c] * beta[c];
    sse += w[i] * (y[i] - fit) ** 2;
    sw += w[i];
  }
  const effN = sw > 0 ? (sw * sw) / w.reduce((a, v) => a + v * v, 0) : 0; // Kish 유효표본수
  const dof = Math.max(1, effN - k);
  const sigma = Math.sqrt(sse / Math.max(1e-9, sw) * (effN / dof));
  return { beta, sigma: Number.isFinite(sigma) ? sigma : 0, dof };
}

/** Kish 유효표본수 — 가중치가 한쪽에 쏠릴수록 작아진다. */
export function effectiveN(ws: number[]): number {
  const s1 = ws.reduce((a, v) => a + v, 0);
  const s2 = ws.reduce((a, v) => a + v * v, 0);
  return s2 > 0 ? (s1 * s1) / s2 : 0;
}

/** 단순 OLS 기울기 (x는 0,1,2,... 인덱스) — 추세 연장용 */
export function trendSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 3) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) ** 2;
  }
  return den > 0 ? num / den : 0;
}

/** 정규분포 80% 구간의 z값 */
export const Z80 = 1.2815515655446004;

/**
 * 국소선형 평활 (tricube 가중 LOESS, 1차).
 *
 * 3점 이동평균은 계열의 양 끝에서 값을 안쪽으로 끌어당긴다 — 상승장에서
 * 마지막 달을 실제보다 낮게 만들어 "최근 1년 변동률"을 과소평가한다.
 * 국소 *선형* 적합은 끝에서도 기울기를 살리므로 그 편향이 없다.
 *
 * @param ys 결측(null)이 섞인 시계열
 * @param bandwidth 좌우로 몇 칸까지 볼지
 */
export function loessLinear(ys: (number | null)[], bandwidth = 3): (number | null)[] {
  const n = ys.length;
  const out = new Array<number | null>(n).fill(null);
  const tricube = (u: number) => (u >= 1 ? 0 : (1 - u ** 3) ** 3);

  for (let i = 0; i < n; i++) {
    const pts: { d: number; y: number; w: number }[] = [];
    for (let j = Math.max(0, i - bandwidth); j <= Math.min(n - 1, i + bandwidth); j++) {
      const y = ys[j];
      if (y == null || !Number.isFinite(y)) continue;
      const w = tricube(Math.abs(j - i) / (bandwidth + 1));
      if (w > 0) pts.push({ d: j - i, y, w });
    }
    if (pts.length === 0) continue;
    if (pts.length === 1) {
      out[i] = pts[0].y;
      continue;
    }
    // 가중 1차 회귀: y = a + b·d 를 풀고 d=0 의 값(a)을 취한다
    let sw = 0;
    let sd = 0;
    let sy = 0;
    let sdd = 0;
    let sdy = 0;
    for (const p of pts) {
      sw += p.w;
      sd += p.w * p.d;
      sy += p.w * p.y;
      sdd += p.w * p.d * p.d;
      sdy += p.w * p.d * p.y;
    }
    const den = sw * sdd - sd * sd;
    if (Math.abs(den) < 1e-12) {
      out[i] = sy / sw;
      continue;
    }
    out[i] = (sdd * sy - sd * sdy) / den;
  }
  return out;
}

/** 표준정규 누적분포 — Abramowitz & Stegun 7.1.26 기반 erf 근사 */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

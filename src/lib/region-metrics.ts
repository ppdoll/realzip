import { kaptMatcher } from './kapt-match';
import { median, quantile } from './stats';
import { recentMonths } from './months';
import { fetchAllPaged, serverClient } from './supabase';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  구 단위 분포 — 절대값을 "읽히는 값"으로 바꾸기
 * ────────────────────────────────────────────────────────────────────────
 *
 *  회전율 0.9%, 전세가율 20.6% 같은 숫자는 그 자체로는 감이 오지 않는다.
 *  같은 구의 분포 안에서 어디쯤인지 붙여야 읽힌다 — "강남구 평균 2.4%, 하위 8%".
 *
 *  새 API 를 붙이지 않고 이미 담아둔 데이터(매매·전월세·단지정보)만 엮는다.
 *  구 하나가 매매 1만 · 전월세 1만 · 단지정보 200행 수준이라 슬림 조회로 감당되고,
 *  결과는 구별로 캐시한다.
 *
 *  회전율과 전세가율을 **따로** 계산하는 이유: 회전율은 단지정보(세대수)만 필요하고
 *  전세가율은 전월세가 필요하다. 한쪽만 쓸 때 다른 쪽 조회까지 하면 낭비다.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;

const norm = (s: string) =>
  (s ?? '').replace(/\s+/g, '').replace(/[()[\]·.,\-_/]/g, '').toLowerCase();

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 분포 안에서의 위치 — 낮을수록 하위 */
function percentileOf(values: number[], v: number): number {
  if (values.length === 0) return 50;
  const below = values.filter((x) => x < v).length;
  return Math.round((below / values.length) * 100);
}

export type Distribution = {
  /** 표본 수 */
  count: number;
  median: number;
  p25: number;
  p75: number;
};

/**
 * 분포를 만들 최소 표본은 **20곳**이다.
 *
 * 처음엔 5곳으로 뒀는데, 13곳에서 "하위 30%" 라고 적으면 그 근거가 단지 4곳이다.
 * 그건 비교라기보다 우연이다. 감사에서 종로구 19곳 · 부천 오정구 19곳 · 과천시 13곳이
 * 걸렸고, 이 구들은 비교를 아예 보여주지 않는 게 맞다 —
 * 없는 근거로 순위를 적어 주는 것보다 값만 보여주는 게 낫다.
 */
const MIN_DISTRIBUTION = 20;

function describe(values: number[]): Distribution | null {
  if (values.length < MIN_DISTRIBUTION) return null;
  return {
    count: values.length,
    median: round1(median(values)),
    p25: round1(quantile(values, 0.25)),
    p75: round1(quantile(values, 0.75)),
  };
}

// ── 회전율 ──────────────────────────────────────────────────────────────

/** 단지 하나의 회전율 계산 내역 */
export type TurnoverEntry = {
  pct: number;
  /** 최근 1년 매매 (단지의 모든 블록 합산) */
  sales: number;
  households: number;
  /** 이 단지로 붙은 실거래 단지들 — 고층/저층처럼 쪼개져 올 때 둘 이상이다 */
  blocks: { aptSeq: string; aptNm: string; sales: number }[];
};

export type TurnoverInfo = {
  /**
   * 회전율 (%) — 키는 apt_seq.
   * 한 K-apt 단지가 실거래에서 여러 apt_seq 로 쪼개져 오면 모두 같은 값을 가리킨다.
   */
  byComplex: Map<string, number>;
  /** kaptCode → 계산 내역. 상세 화면이 같은 값을 쓰려면 이쪽을 본다 */
  byKapt: Map<string, TurnoverEntry>;
  /** 구 전체 분포 — 단지(kaptCode) 하나를 한 번만 센다 */
  distribution: Distribution | null;
};

const turnoverCache = new Map<string, { at: number; data: TurnoverInfo }>();

/**
 * 구 안 모든 단지의 회전율(최근 1년 매매 ÷ 세대수).
 * 세대수는 단지정보(K-apt)에 있고 조인은 (법정동 + 지번)으로 한다 — 이름은 표기가 갈린다.
 */
export async function regionTurnover(lawdCd: string): Promise<TurnoverInfo> {
  const hit = turnoverCache.get(lawdCd);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const db = serverClient();
  const from12 = recentMonths(12)[0];

  const [kapt, trades] = await Promise.all([
    fetchAllPaged<{
      kapt_code: string;
      umd_nm: string;
      jibun: string | null;
      kapt_name: string;
      households: number | null;
    }>(
      () =>
        db
          .from('apt_kapt')
          .select('kapt_code, umd_nm, jibun, kapt_name, households')
          .eq('lawd_cd', lawdCd)
          .not('households', 'is', null)
          .gt('households', 0),
      { label: 'apt_kapt 조회' },
    ),
    fetchAllPaged<{ apt_seq: string; apt_nm: string; umd_nm: string; jibun: string | null }>(
      () =>
        db
          .from('apt_trade')
          .select('apt_seq, apt_nm, umd_nm, jibun')
          .eq('lawd_cd', lawdCd)
          .eq('canceled', false)
          .gte('deal_ym', from12),
      { label: 'apt_trade 조회' },
    ),
  ]);

  const match = kaptMatcher(
    kapt.map((k) => ({
      kaptCode: k.kapt_code,
      umdNm: k.umd_nm,
      jibun: k.jibun,
      kaptName: k.kapt_name,
      households: Number(k.households),
    })),
  );

  /** 실거래 단지(apt_seq)별 거래 건수 + 조인에 쓸 대표 신원 */
  const counts = new Map<
    string,
    { n: number; umdNm: string | null; jibun: string | null; aptNm: string }
  >();
  for (const t of trades) {
    const cur = counts.get(t.apt_seq);
    if (cur) cur.n++;
    else counts.set(t.apt_seq, { n: 1, umdNm: t.umd_nm, jibun: t.jibun, aptNm: t.apt_nm });
  }

  /**
   * **K-apt 단지 단위로 합친다.**
   *
   * 실거래 자료는 한 단지를 블록으로 쪼개 보낸다 — 상계주공1이 (고층) 144건,
   * (저층) 6건으로 따로 온다. 세대수는 단지 전체(2,064세대) 하나뿐이라
   * apt_seq 별로 나누면 저층이 6/2064 = 0.3% 가 되어 "손바뀜 거의 없는 단지" 로
   * 읽힌다. 실제 상계주공1은 (144+6)/2064 = 7.3% 로 노원 상위권이다.
   * 실측으로 노원 회전율 최저 7곳 중 4곳이 이런 (저층) 조각이었다.
   *
   * 그래서 같은 kaptCode 로 붙은 거래는 모두 더한 뒤 한 번만 나눈다.
   * 분포도 단지 하나를 한 번만 세도록 kaptCode 기준으로 만든다.
   */
  const byKapt = new Map<string, TurnoverEntry>();
  for (const [aptSeq, c] of counts) {
    const k = match(c);
    if (!k || !(k.households > 0)) continue;
    const block = { aptSeq, aptNm: c.aptNm, sales: c.n };
    const cur = byKapt.get(k.kaptCode);
    if (cur) {
      cur.sales += c.n;
      cur.blocks.push(block);
    } else {
      byKapt.set(k.kaptCode, {
        pct: 0,
        sales: c.n,
        households: k.households,
        blocks: [block],
      });
    }
  }

  const byComplex = new Map<string, number>();
  const values: number[] = [];
  for (const e of byKapt.values()) {
    e.pct = round1((e.sales / e.households) * 100);
    e.blocks.sort((a, b) => b.sales - a.sales);
    // 같은 단지의 블록들은 모두 같은 값을 본다 — 어느 블록으로 들어와도 답이 같아야 한다
    for (const b of e.blocks) byComplex.set(b.aptSeq, e.pct);
    values.push(e.pct);
  }

  const data: TurnoverInfo = { byComplex, byKapt, distribution: describe(values) };
  turnoverCache.set(lawdCd, { at: Date.now(), data });
  return data;
}

// ── 전세가율 ────────────────────────────────────────────────────────────

export type JeonseRatioInfo = {
  /** 단지별 전세가율 (%) — 키는 apt_seq */
  byComplex: Map<string, number>;
  distribution: Distribution | null;
};

const jeonseCache = new Map<string, { at: number; data: JeonseRatioInfo }>();

/**
 * 구 안 모든 단지의 전세가율.
 *
 * 상세 화면은 회귀 추정끼리 나누지만, 여기서는 **같은 평형의 중위 실거래끼리** 나눈다 —
 * 수백 단지에 회귀를 돌릴 수 없고, 분포 안 위치를 보는 데는 같은 기준이면 충분하다.
 * 매매·전월세 모두 국토부 자료라 단지명 표기가 일치해서 (법정동 + 단지명)으로 묶인다.
 */
export async function regionJeonseRatios(lawdCd: string): Promise<JeonseRatioInfo> {
  const hit = jeonseCache.get(lawdCd);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const db = serverClient();
  const from12 = recentMonths(12)[0];

  const [trades, rents] = await Promise.all([
    fetchAllPaged<{ apt_seq: string; apt_nm: string; umd_nm: string; area: number; amount: number }>(
      () =>
        db
          .from('apt_trade')
          .select('apt_seq, apt_nm, umd_nm, area, amount')
          .eq('lawd_cd', lawdCd)
          .eq('canceled', false)
          .gte('deal_ym', from12),
      { label: 'apt_trade 조회' },
    ),
    fetchAllPaged<{ apt_nm: string; umd_nm: string; area: number; deposit: number }>(
      () =>
        db
          .from('apt_rent')
          .select('apt_nm, umd_nm, area, deposit')
          .eq('lawd_cd', lawdCd)
          .eq('monthly_rent', 0)
          .gte('deal_ym', from12),
      { label: 'apt_rent 조회' },
    ),
  ]);

  /** (법정동|단지명|면적버킷) → 금액들 */
  const bucket = (umd: string, apt: string, area: number) =>
    `${norm(umd)}|${norm(apt)}|${Math.round(area)}`;

  const saleAmounts = new Map<string, number[]>();
  /** 어느 버킷이 어느 apt_seq 인지 (거래가 가장 많은 평형을 대표로 쓴다) */
  const bucketSeq = new Map<string, { aptSeq: string; n: number }>();
  for (const t of trades) {
    const b = bucket(t.umd_nm ?? '', t.apt_nm, Number(t.area));
    const arr = saleAmounts.get(b);
    if (arr) arr.push(Number(t.amount));
    else saleAmounts.set(b, [Number(t.amount)]);
    const cur = bucketSeq.get(b);
    if (cur) cur.n++;
    else bucketSeq.set(b, { aptSeq: t.apt_seq, n: 1 });
  }

  const depositAmounts = new Map<string, number[]>();
  for (const r of rents) {
    if (!(Number(r.deposit) > 0)) continue;
    const b = bucket(r.umd_nm ?? '', r.apt_nm, Number(r.area));
    const arr = depositAmounts.get(b);
    if (arr) arr.push(Number(r.deposit));
    else depositAmounts.set(b, [Number(r.deposit)]);
  }

  /** 단지별로 거래가 가장 많은 평형 하나를 대표로 삼는다 */
  const best = new Map<string, { n: number; ratio: number }>();
  for (const [b, sales] of saleAmounts) {
    const deposits = depositAmounts.get(b);
    /**
     * 양쪽 모두 3건 이상일 때만.
     *
     * 처음에는 2건으로 잡았는데 **2개의 중위값은 그냥 두 값의 평균**이라 잡음이
     * 그대로 통과했다. 63개 구 감사에서 전세가율 100% 초과 37건이 잡혔고, 원자료를
     * 보니 두 종류였다:
     *   - 실제 (고덕코아루더블루시티 21㎡: 매매 116건 6,314만 / 전세 16건 1억 = 158%)
     *     소형 도시형생활주택의 깡통전세는 실재한다 — 이건 지워선 안 된다.
     *   - 잡음 (건양하늘터 85㎡: 매매 2건 6.15억·6.9억 / 전세 2건 = 104%)
     *     한쪽 거래 하나가 중위를 끌고 간 것뿐이다.
     * 3건으로 올리면 뒤쪽만 빠진다.
     */
    if (!deposits || sales.length < 3 || deposits.length < 3) continue;
    const saleMed = median(sales);
    if (!(saleMed > 0)) continue;
    const ratio = round1((median(deposits) / saleMed) * 100);
    const seq = bucketSeq.get(b);
    if (!seq) continue;
    const cur = best.get(seq.aptSeq);
    if (!cur || seq.n > cur.n) best.set(seq.aptSeq, { n: seq.n, ratio });
  }

  const byComplex = new Map<string, number>();
  const values: number[] = [];
  for (const [aptSeq, v] of best) {
    byComplex.set(aptSeq, v.ratio);
    values.push(v.ratio);
  }

  const data: JeonseRatioInfo = { byComplex, distribution: describe(values) };
  jeonseCache.set(lawdCd, { at: Date.now(), data });
  return data;
}

// ── 화면에 넘길 형태 ────────────────────────────────────────────────────

export type Positioned = {
  /** 이 단지 값 */
  value: number;
  /** 구 분포 */
  distribution: Distribution;
  /** 구 안 백분위 (0 = 최하위) */
  percentile: number;
  /** 구 중위 대비 배수 */
  vsMedian: number;
};

export function position(value: number | null, dist: Distribution | null, all: number[]): Positioned | null {
  if (value == null || !dist) return null;
  return {
    value,
    distribution: dist,
    percentile: percentileOf(all, value),
    vsMedian: dist.median > 0 ? round1(value / dist.median) : 1,
  };
}

/** position() 에 넘길 원본 값 배열 */
export function valuesOf(byComplex: Map<string, number>): number[] {
  return [...byComplex.values()];
}


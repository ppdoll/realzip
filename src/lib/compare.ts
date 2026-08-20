import type { ConfidenceLevel, IndexPoint, Trade } from './types';
import { estimate } from './estimate';
import { PYEONG, Z80, median, normalCdf, quantile } from './stats';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  매물 호가 ↔ 추정 실거래가 대조
 * ────────────────────────────────────────────────────────────────────────
 *
 *  개별 매물 호가를 제공하는 무료·공개 API 는 존재하지 않는다.
 *  (공공데이터포털은 실거래가만, 네이버부동산은 공식 API 없음, KB시세는 유료)
 *  그래서 사용자가 보고 있는 호가를 그대로 붙여넣게 하고, 서버가 같은 모델로
 *  그 면적·층의 추정가를 계산해 대조한다.
 *
 *  호가는 매도 희망가라 통상 실거래가보다 높다. 여기서 내는 값은 "이 호가가
 *  최근 실거래 흐름 기준 추정 구간의 어디에 있는지"라는 사실 관계이고,
 *  사라/팔라 같은 판단은 하지 않는다.
 */

export type ParsedListing = {
  /** 입력 원문 (한 줄) */
  raw: string;
  /** 만원 */
  price: number | null;
  floor: number | null;
  /** 층수 대신 저층/중층/고층으로만 표기된 경우 */
  floorHint: 'low' | 'mid' | 'high' | null;
  /** 전용면적 m² */
  area: number | null;
  error?: string;
};

const NUM = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;

function toNumber(s: string): number {
  return Number(s.replace(/,/g, ''));
}

/**
 * 붙여넣은 텍스트를 한 줄씩 매물로 읽는다.
 *
 * 받아들이는 형태 (섞여 있어도 됨):
 *   18억 5,000        →  185,000만원
 *   18억5천 12층
 *   18.5억 중층
 *   109.42/84.97㎡ 12/15층 18억5000
 *   185000 12층
 *   34평 12층 18억
 */
export function parseListings(text: string): ParsedListing[] {
  const out: ParsedListing[] = [];

  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw) continue;
    // 구분선·머리글로 보이는 줄은 조용히 건너뛴다
    if (/^[-=·•*#\s]+$/.test(raw)) continue;

    if (/전세|월세|반전세/.test(raw)) {
      out.push({
        raw,
        price: null,
        floor: null,
        floorHint: null,
        area: null,
        error: '매매 매물만 비교합니다 (전월세 제외)',
      });
      continue;
    }

    let rest = raw;
    const eat = (re: RegExp): RegExpMatchArray | null => {
      const m = rest.match(re);
      if (m) rest = rest.replace(m[0], ' ');
      return m;
    };

    // ── 층 ──  "12/15층"(해당층/총층) → 12,  "중/15층" → 중층
    let floor: number | null = null;
    let floorHint: ParsedListing['floorHint'] = null;

    const slashFloor = eat(/(-?\d{1,3})\s*\/\s*\d{1,3}\s*층/);
    if (slashFloor) {
      floor = Number(slashFloor[1]);
    } else {
      const hintSlash = eat(/(저|중|고)\s*\/\s*\d{1,3}\s*층/);
      if (hintSlash) {
        floorHint = hintSlash[1] === '저' ? 'low' : hintSlash[1] === '고' ? 'high' : 'mid';
      } else {
        const plainHint = eat(/(저층|중층|고층)/);
        if (plainHint) {
          floorHint =
            plainHint[1] === '저층' ? 'low' : plainHint[1] === '고층' ? 'high' : 'mid';
        } else {
          const plain = eat(/(-?\d{1,3})\s*층/);
          if (plain) floor = Number(plain[1]);
        }
      }
    }

    // ── 면적 ──  "109.42/84.97㎡"(공급/전용) → 84.97,  "34평" → m² 환산
    let area: number | null = null;
    const m2 = eat(new RegExp(String.raw`(?:${NUM}\s*/\s*)?(${NUM})\s*(?:㎡|m2|m²)`, 'i'));
    if (m2) {
      area = toNumber(m2[1]);
    } else {
      const py = eat(new RegExp(String.raw`(?:${NUM}\s*/\s*)?(${NUM})\s*평`));
      if (py) area = toNumber(py[1]) * PYEONG;
    }

    // ── 금액 ──
    let price: number | null = null;
    const eok = rest.match(new RegExp(String.raw`(${NUM})\s*억`));
    if (eok) {
      price = toNumber(eok[1]) * 10_000;
      const tail = rest.slice((eok.index ?? 0) + eok[0].length);
      // "18억 5천" → 5,000만원 / "18억 5000" → 5,000만원
      const sub = tail.match(new RegExp(String.raw`^\s*(${NUM})\s*(천|만)?`));
      if (sub) {
        const v = toNumber(sub[1]);
        price += sub[2] === '천' ? v * 1_000 : v;
      }
    } else {
      // 억 표기가 없으면 만원 단위 숫자로 본다 (1,000만원 이상만 인정)
      const candidates = [...rest.matchAll(new RegExp(NUM, 'g'))]
        .map((m) => toNumber(m[0]))
        .filter((v) => v >= 1_000);
      if (candidates.length > 0) price = Math.max(...candidates);
    }

    if (price == null || !Number.isFinite(price) || price <= 0) {
      out.push({ raw, price: null, floor, floorHint, area, error: '금액을 읽지 못했습니다' });
      continue;
    }
    if (price < 1_000 || price > 50_000_000) {
      out.push({ raw, price: null, floor, floorHint, area, error: '금액 범위가 이상합니다' });
      continue;
    }

    out.push({ raw, price, floor, floorHint, area });
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────

export type ListingComparison = {
  raw: string;
  /** 호가 (만원) */
  price: number;
  floor: number | null;
  /** 층이 저/중/고 로만 주어져 추정한 경우 true */
  floorAssumed: boolean;
  /** 비교에 쓴 전용면적 (m²) */
  area: number;
  /** 같은 면적·층의 추정 실거래가 (만원) */
  estimated: number;
  low: number;
  high: number;
  /** (호가 - 추정가) / 추정가 × 100 */
  gapPct: number;
  /** 추정 분포에서 이 호가의 백분위 (0~100) */
  percentile: number;
  /** 추정 80% 구간 대비 위치 */
  position: 'below' | 'inside' | 'above';
  confidence: ConfidenceLevel;
};

export type CompareResult = {
  items: ListingComparison[];
  invalid: { raw: string; error: string }[];
  summary: {
    count: number;
    minPrice: number;
    medianPrice: number;
    maxPrice: number;
    /** 호가 중위값의 추정가 대비 괴리율 */
    medianGapPct: number;
    belowCount: number;
    insideCount: number;
    aboveCount: number;
  } | null;
};

export type CompareInput = {
  regionTrades: Trade[];
  complexTrades: Trade[];
  index: IndexPoint[];
  /** 면적이 안 적힌 매물에 적용할 기본 전용면적 */
  defaultArea: number;
  listings: ParsedListing[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function compareListings(input: CompareInput): CompareResult {
  const { regionTrades, complexTrades, index, defaultArea, listings } = input;

  const invalid: { raw: string; error: string }[] = [];
  const valid: ParsedListing[] = [];
  for (const l of listings) {
    if (l.error || l.price == null) invalid.push({ raw: l.raw, error: l.error ?? '해석 실패' });
    else valid.push(l);
  }

  // 저층/중층/고층 → 이 단지에서 실제로 거래된 층 분포로 환산
  const observedFloors = complexTrades
    .filter((t) => t.floor != null)
    .map((t) => t.floor!);
  const floorFor = (hint: ParsedListing['floorHint']): number | null => {
    if (!hint || observedFloors.length === 0) return null;
    const q = hint === 'low' ? 0.2 : hint === 'high' ? 0.8 : 0.5;
    return Math.round(quantile(observedFloors, q));
  };

  // 같은 (면적, 층) 조합은 한 번만 계산한다
  const cache = new Map<string, ReturnType<typeof estimate>>();
  const estimateFor = (area: number, floor: number | null) => {
    const key = `${area.toFixed(2)}|${floor ?? 'x'}`;
    if (!cache.has(key)) {
      cache.set(key, estimate({ regionTrades, complexTrades, index, area, floor }));
    }
    return cache.get(key)!;
  };

  const items: ListingComparison[] = [];
  for (const l of valid) {
    const area = l.area ?? defaultArea;
    const assumedFloor = l.floor ?? floorFor(l.floorHint);
    const est = estimateFor(area, assumedFloor);
    if (!est) {
      invalid.push({ raw: l.raw, error: '이 면적의 거래 표본이 없어 비교할 수 없습니다' });
      continue;
    }

    // 잘못 읽은 금액 걸러내기.
    // 예를 들어 "18억"의 억 자가 깨져 들어오면 5,000만원으로 읽히는데,
    // 그걸 "-95%" 로 보고하면 사용자가 진짜 괴리로 착각한다. 단지 시세와
    // 2배 이상 동떨어진 값은 결과가 아니라 입력 문제로 돌린다.
    if (l.price! < est.price * 0.4 || l.price! > est.price * 2.5) {
      invalid.push({
        raw: l.raw,
        error: `${Math.round(l.price! / 10_000 * 10) / 10}억으로 읽혔는데 이 단지 시세(약 ${Math.round(est.price / 10_000 * 10) / 10}억)와 너무 달라 잘못 읽은 것 같습니다`,
      });
      continue;
    }

    // 80% 구간에서 로그정규 분산을 되돌려 백분위를 구한다
    const sigma =
      est.high > 0 && est.low > 0 ? Math.log(est.high / est.low) / (2 * Z80) : 0.05;
    const z = sigma > 0 ? Math.log(l.price! / est.price) / sigma : 0;

    items.push({
      raw: l.raw,
      price: l.price!,
      floor: assumedFloor,
      floorAssumed: l.floor == null && assumedFloor != null,
      area: round1(area),
      estimated: est.price,
      low: est.low,
      high: est.high,
      gapPct: round1(((l.price! - est.price) / est.price) * 100),
      // 0% / 100% 는 문자열로는 확정처럼 읽히지만 실제로 그런 확률은 없다 → 양끝을 남겨둔다
      percentile: Math.min(99.9, Math.max(0.1, Math.round(normalCdf(z) * 1000) / 10)),
      position: l.price! < est.low ? 'below' : l.price! > est.high ? 'above' : 'inside',
      confidence: est.confidence,
    });
  }

  items.sort((a, b) => a.price - b.price);

  if (items.length === 0) return { items, invalid, summary: null };

  const prices = items.map((i) => i.price);
  const medPrice = median(prices);
  // 중위 호가를 중위 추정가와 비교 (매물별 면적이 섞여 있을 수 있어 추정가도 중위로)
  const medEstimated = median(items.map((i) => i.estimated));

  return {
    items,
    invalid,
    summary: {
      count: items.length,
      minPrice: Math.min(...prices),
      medianPrice: Math.round(medPrice),
      maxPrice: Math.max(...prices),
      medianGapPct: round1(((medPrice - medEstimated) / medEstimated) * 100),
      belowCount: items.filter((i) => i.position === 'below').length,
      insideCount: items.filter((i) => i.position === 'inside').length,
      aboveCount: items.filter((i) => i.position === 'above').length,
    },
  };
}

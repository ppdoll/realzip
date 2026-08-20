import { PYEONG } from './stats';

/** 만원 단위 금액을 한국식으로 (예: 125000 → "12억 5,000만") */
export function krw(manwon: number | null | undefined): string {
  if (manwon == null || !Number.isFinite(manwon)) return '—';
  const v = Math.round(manwon);
  if (Math.abs(v) < 10_000) return `${v.toLocaleString('ko-KR')}만`;
  const eok = Math.floor(v / 10_000);
  const rest = v % 10_000;
  return rest === 0 ? `${eok}억` : `${eok}억 ${rest.toLocaleString('ko-KR')}만`;
}

/** 축·타일용 짧은 표기 (예: 125000 → "12.5억") */
export function krwShort(manwon: number | null | undefined): string {
  if (manwon == null || !Number.isFinite(manwon)) return '—';
  const v = Math.round(manwon);
  if (Math.abs(v) < 10_000) return `${v.toLocaleString('ko-KR')}만`;
  const eok = v / 10_000;
  return `${eok >= 100 ? eok.toFixed(0) : eok.toFixed(1)}억`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

/** 전용면적 표기 (예: 84.97 → "84.97㎡ · 25평") */
export function areaLabel(m2: number): string {
  return `${m2.toFixed(2)}㎡ · ${Math.round(m2 / PYEONG)}평`;
}

export function pyeong(m2: number): number {
  return Math.round(m2 / PYEONG);
}

/** YYYY-MM-DD → "25.03.14" */
export function shortDate(d: string): string {
  return `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)}`;
}

export const CONFIDENCE_LABEL = {
  high: '높음',
  medium: '보통',
  low: '낮음',
} as const;

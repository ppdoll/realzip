/** 계약년월(YYYYMM) 유틸 */

export function toYm(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ymToDate(ym: string): Date {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)) - 1, 1);
}

export function addMonths(ym: string, delta: number): string {
  const d = ymToDate(ym);
  d.setMonth(d.getMonth() + delta);
  return toYm(d);
}

export function monthDiff(from: string, to: string): number {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(4, 6));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(4, 6));
  return (ty - fy) * 12 + (tm - fm);
}

/** from ~ to (양끝 포함) 월 목록 */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (monthDiff(cur, to) >= 0 && out.length < 600) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/**
 * 최근 n개월 목록.
 * 실거래 신고 기한이 계약일로부터 30일이라 당월/전월 데이터는 아직 덜 차 있다.
 */
export function recentMonths(n: number, now = new Date()): string[] {
  const end = toYm(now);
  return monthRange(addMonths(end, -(n - 1)), end);
}

export function ymLabel(ym: string): string {
  return `${ym.slice(0, 4)}.${ym.slice(4, 6)}`;
}

export function dateToYm(dealDate: string): string {
  return dealDate.slice(0, 4) + dealDate.slice(5, 7);
}

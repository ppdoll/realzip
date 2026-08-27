import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  매일 리포트 — 저장소에 파일로 남기고, DB 는 읽지 않는다
 * ────────────────────────────────────────────────────────────────────────
 *
 *  하루치 리포트는 `content/reports/YYYY-MM-DD.json` 파일 하나다.
 *  왜 DB 가 아니라 파일인가:
 *
 *   · **읽기 비용이 0** — 리포트 페이지가 Supabase 를 건드리지 않는다. 용량은
 *     사실 문제가 아니다(하루 20KB, 연 7MB). 무료 티어에서 먼저 걸리는 건
 *     용량이 아니라 요청·대역폭이다.
 *   · **이력이 git 에 남는다** — 지난 리포트가 나중에 바뀌지 않았다는 게
 *     커밋으로 증명된다. 그리고 **전일 대비**를 계산할 자료가 공짜로 생긴다.
 *     `apt_trade` 는 매일 덮어쓰기라 "어제는 몇 건이었나"를 DB 로는 알 수 없다.
 *   · Supabase 가 멈춰도 리포트는 살아 있다.
 *
 *  ── 파일을 언제 읽나 ────────────────────────────────────────────────────
 *  **빌드할 때만** 읽는다. 리포트 페이지는 전부 미리 만든다(`dynamicParams`
 *  없음). 서버리스 번들에 임의 파일이 들어간다고 보장할 수 없으므로 런타임에
 *  파일을 읽는 길은 아예 두지 않는다. 리포트가 새로 생기는 시점은 커밋이고,
 *  커밋은 곧 배포이므로 미리 만들기만 해도 항상 최신이다.
 */

/** 리포트 파일이 사는 곳 (저장소 루트 기준) */
export const REPORTS_DIR = join(process.cwd(), 'content', 'reports');

/** 한 지역의 하루치 요약 */
export type ReportRegion = {
  lawdCd: string;
  name: string;
  sido: string;
  /** 월별 신고 건수 — 전일 대비를 창이 굴러가도 비교할 수 있게 월별로 남긴다 */
  dealsByMonth: Record<string, number>;
  /** 최근 30일 전용 평당 중위 (만원). 표본이 적으면 null */
  ppp: number | null;
  /** 그 직전 30일 평당 중위 (만원) */
  pppPrev: number | null;
  /** 최근 30일 거래 수 */
  deals30: number;
};

/** 평단가가 높은 거래 하나 */
export type ReportDeal = {
  aptSeq: string;
  aptNm: string;
  regionLabel: string;
  umdNm: string;
  area: number;
  pyeong: number;
  amount: number;
  ppp: number;
  dealDate: string;
  floor: number | null;
};

/** 한국은행 ECOS 핵심지표 하나 */
export type ReportRate = {
  group: string;
  name: string;
  value: number;
  unit: string;
  /** 기준 시점 원문 — 일별(20260827)·월별(202607)·분기(2026Q2)가 섞여 있다 */
  cycle: string;
  /** 사람이 읽는 기준 시점 */
  asOf: string;
};

export type DailyReport = {
  /** KST 기준 생성 날짜 */
  date: string;
  generatedAt: string;
  /** 건수를 센 달들 */
  months: string[];
  /** 직전 리포트 날짜 — 전일 대비의 기준 */
  prevDate: string | null;
  totals: {
    /** months 안의 총 신고 건수 */
    deals: number;
    /** 직전 리포트와 겹치는 달만 비교한 증가분. 비교 불가면 null */
    newDeals: number | null;
    regions: number;
  };
  regions: ReportRegion[];
  /** 이달 평단가 상위 거래 */
  topDeals: ReportDeal[];
  /** ECOS 핵심지표. 키가 없으면 null */
  rates: ReportRate[] | null;
};

/** 시도 단위로 접은 값 — 페이지에서 쓴다 */
export type SidoRollup = {
  sido: string;
  deals: number;
  newDeals: number | null;
  regions: number;
  /** 지역 평단가 중위들의 중위 — 지역 크기를 무시한 값이라 "동네 수준" 용도 */
  pppMedian: number | null;
};

/** 있는 리포트 날짜를 새 것부터 */
export function reportDates(): string[] {
  if (!existsSync(REPORTS_DIR)) return [];
  return readdirSync(REPORTS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort()
    .reverse();
}

export function loadReport(date: string): DailyReport | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const path = join(REPORTS_DIR, `${date}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as DailyReport;
}

export function latestReport(): DailyReport | null {
  const [newest] = reportDates();
  return newest ? loadReport(newest) : null;
}

/**
 * 전일 대비 증가분. **두 리포트에 함께 있는 달만** 더한다 —
 * 조회 창이 매달 굴러가므로 창이 바뀐 날에 그냥 총합을 빼면
 * 빠진 달만큼 음수가 나온다.
 */
export function newDealsOf(
  cur: Record<string, number>,
  prev: Record<string, number> | undefined,
): number | null {
  if (!prev) return null;
  const shared = Object.keys(cur).filter((ym) => ym in prev);
  if (shared.length === 0) return null;
  return shared.reduce((s, ym) => s + (cur[ym] - prev[ym]), 0);
}

export const sumMonths = (m: Record<string, number>) =>
  Object.values(m).reduce((s, v) => s + v, 0);

/** 시도별로 접는다. prev 를 주면 전일 대비도 채운다 */
export function rollupBySido(report: DailyReport, prev: DailyReport | null): SidoRollup[] {
  const prevByCode = new Map((prev?.regions ?? []).map((r) => [r.lawdCd, r.dealsByMonth]));
  const acc = new Map<string, { deals: number; newDeals: number | null; ppps: number[]; n: number }>();

  for (const r of report.regions) {
    const cur = acc.get(r.sido) ?? { deals: 0, newDeals: null, ppps: [], n: 0 };
    cur.deals += sumMonths(r.dealsByMonth);
    cur.n += 1;
    if (r.ppp != null) cur.ppps.push(r.ppp);
    const nd = newDealsOf(r.dealsByMonth, prevByCode.get(r.lawdCd));
    if (nd != null) cur.newDeals = (cur.newDeals ?? 0) + nd;
    acc.set(r.sido, cur);
  }

  return [...acc.entries()]
    .map(([sido, v]) => {
      const sorted = [...v.ppps].sort((a, b) => a - b);
      return {
        sido,
        deals: v.deals,
        newDeals: v.newDeals,
        regions: v.n,
        pppMedian: sorted.length ? Math.round(sorted[Math.floor((sorted.length - 1) / 2)]) : null,
      };
    })
    .sort((a, b) => b.deals - a.deals);
}

/** 화면에 쓰는 날짜 표기 */
export function krDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

/** ECOS 기준 시점(20260827 / 202607 / 2026Q2 / 2024)을 사람이 읽는 말로 */
export function cycleLabel(cycle: string): string {
  if (/^\d{8}$/.test(cycle)) {
    return `${cycle.slice(0, 4)}.${cycle.slice(4, 6)}.${cycle.slice(6, 8)} 기준`;
  }
  if (/^\d{6}$/.test(cycle)) return `${cycle.slice(0, 4)}년 ${Number(cycle.slice(4, 6))}월 기준`;
  if (/^\d{4}Q\d$/.test(cycle)) return `${cycle.slice(0, 4)}년 ${cycle.slice(5)}분기 기준`;
  if (/^\d{4}$/.test(cycle)) return `${cycle}년 기준`;
  return `${cycle} 기준`;
}

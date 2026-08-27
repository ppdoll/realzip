/**
 * 매일 리포트 생성 — `content/reports/YYYY-MM-DD.json` 을 만든다.
 *
 *   npm run report:build            오늘(KST) 리포트
 *   npm run report:build -- --dry   파일을 쓰지 않고 요약만 출력
 *
 * ── 왜 Claude 가 아니라 스크립트인가 ────────────────────────────────────
 * 리포트는 판단이 필요 없는 작업이다. 스크립트로 만들면 매일 토큰을 쓰지 않고,
 * 같은 입력이면 같은 출력이 나온다. **문장을 지어내지 않는다** — 숫자와 변화량만
 * 담고 해석은 넣지 않는다. "금리가 내렸으니 지금이 기회" 같은 말은 개인화된
 * 투자 조언이라 이 서비스가 하지 않기로 한 것이다.
 *
 * ── 자료를 어디서 받나 ──────────────────────────────────────────────────
 *  · 실거래 : 우리 DB(`apt_trade`). Vercel 크론이 매일 05:00 KST 에 이미 담아둔
 *    지역의 최근 3개월을 다시 받으므로 매일 새 신고가 반영된다.
 *  · 금리   : 한국은행 ECOS `KeyStatisticList` — **한 번 호출로 101개 지표**.
 *    ECOS_API_KEY 가 없으면 이 블록만 비우고 나머지는 그대로 만든다.
 *
 * ── 한 번만 읽는 이유 ───────────────────────────────────────────────────
 * 네 블록(신고 건수·지역 평단가·시도 집계·최고가 거래)을 **같은 한 벌의 행**에서
 * 계산한다. 블록마다 따로 질의하면 사이에 크론이 끼어들어 서로 안 맞는 숫자가
 * 한 리포트에 섞일 수 있다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REGION_BY_CODE } from '../src/data/regions';
import { recentMonths } from '../src/lib/months';
import {
  loadReport,
  newDealsOf,
  REPORTS_DIR,
  reportDates,
  sumMonths,
  type DailyReport,
  type ReportDeal,
  type ReportRate,
  type ReportRegion,
} from '../src/lib/report';
import { PYEONG, median } from '../src/lib/stats';
import { fetchAllPaged, serverClient } from '../src/lib/supabase';
import { loadEnv } from './env';

/** 건수를 세는 창. 신고 기한이 계약일로부터 30일이라 최근 몇 달이 계속 늘어난다 */
const COUNT_MONTHS = 3;

/** 평단가 비교 창 — 최근 30일과 그 직전 30일 */
const PPP_WINDOW_DAYS = 30;

/** 평단가를 낼 최소 표본. 이보다 적으면 중위값이 한두 건에 휘둘린다 */
const MIN_PPP_DEALS = 10;

/** 최고 평단가 거래를 몇 개 뽑나 */
const TOP_DEALS = 10;

/** ECOS 에서 골라 쓸 지표 — 집을 사는 사람이 실제로 보는 것만 남긴다 */
const RATE_PICKS = [
  '한국은행 기준금리',
  '국고채수익률(3년)',
  '국고채수익률(5년)',
  '회사채수익률(3년,AA-)',
  'CD수익률(91일)',
  '콜금리(익일물)',
  '예금은행 대출금리',
  '예금은행 수신금리',
  '원/달러 환율(종가)',
  '주택매매가격지수',
  '주택전세가격지수',
];

type TradeRow = {
  lawd_cd: string;
  apt_seq: string;
  apt_nm: string;
  umd_nm: string | null;
  deal_date: string;
  deal_ym: string;
  area: number;
  amount: number;
  floor: number | null;
};

/** KST 기준 오늘 날짜 (Action 은 UTC 로 돈다) */
function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 에서 n일 뺀 날짜 */
function minusDays(date: string, n: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) - n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

async function fetchRates(): Promise<ReportRate[] | null> {
  const key = process.env.ECOS_API_KEY;
  if (!key) {
    console.log('· ECOS_API_KEY 없음 — 금리 블록은 비워 둔다');
    return null;
  }
  const url = `https://ecos.bok.or.kr/api/KeyStatisticList/${key}/json/kr/1/120/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ECOS ${res.status}`);
  const body = (await res.json()) as {
    KeyStatisticList?: { row?: Record<string, string>[] };
    RESULT?: { CODE: string; MESSAGE: string };
  };
  if (body.RESULT) throw new Error(`ECOS ${body.RESULT.CODE}: ${body.RESULT.MESSAGE}`);
  const rows = body.KeyStatisticList?.row ?? [];
  if (rows.length === 0) throw new Error('ECOS 가 빈 목록을 돌려줬다');

  const byName = new Map(rows.map((r) => [r.KEYSTAT_NAME, r]));
  const picked: ReportRate[] = [];
  for (const name of RATE_PICKS) {
    const r = byName.get(name);
    // 지표 이름이 바뀔 수 있다 — 없으면 조용히 건너뛰고, 몇 개를 못 찾았는지 아래에서 알린다
    if (!r) continue;
    const value = Number(r.DATA_VALUE);
    if (!Number.isFinite(value)) continue;
    picked.push({
      group: r.CLASS_NAME,
      name,
      value,
      unit: r.UNIT_NAME ?? '',
      cycle: r.CYCLE,
      asOf: r.CYCLE,
    });
  }
  const missing = RATE_PICKS.length - picked.length;
  if (missing > 0) console.log(`· ECOS 지표 ${missing}개를 못 찾았다 (이름이 바뀌었을 수 있음)`);
  console.log(`· ECOS ${picked.length}개 지표`);
  return picked;
}

async function main() {
  loadEnv();
  const dry = process.argv.includes('--dry');
  const date = kstToday();
  const months = recentMonths(COUNT_MONTHS);

  console.log(`매일 리포트 ${date} — 대상 ${months.join(', ')}`);

  // ── 한 벌의 행을 받아 네 블록을 모두 계산한다 ──────────────────────────
  const rows = await fetchAllPaged<TradeRow>(
    () =>
      serverClient()
        .from('apt_trade')
        .select('lawd_cd, apt_seq, apt_nm, umd_nm, deal_date, deal_ym, area, amount, floor')
        .in('deal_ym', months)
        .eq('canceled', false),
    { label: '리포트용 거래 조회', hardLimit: 400_000 },
  );
  console.log(`· 거래 ${rows.length.toLocaleString('ko-KR')}행`);

  const from30 = minusDays(date, PPP_WINDOW_DAYS);
  const from60 = minusDays(date, PPP_WINDOW_DAYS * 2);

  type Acc = { byMonth: Record<string, number>; cur: number[]; prev: number[] };
  const byRegion = new Map<string, Acc>();

  for (const r of rows) {
    let a = byRegion.get(r.lawd_cd);
    if (!a) {
      a = { byMonth: {}, cur: [], prev: [] };
      byRegion.set(r.lawd_cd, a);
    }
    a.byMonth[r.deal_ym] = (a.byMonth[r.deal_ym] ?? 0) + 1;

    const ppp = Number(r.amount) / (Number(r.area) / PYEONG);
    if (r.deal_date >= from30) a.cur.push(ppp);
    else if (r.deal_date >= from60) a.prev.push(ppp);
  }

  const regions: ReportRegion[] = [...byRegion.entries()]
    .map(([lawdCd, a]) => {
      const meta = REGION_BY_CODE.get(lawdCd);
      return {
        lawdCd,
        name: meta?.name ?? lawdCd,
        sido: meta?.sido ?? '기타',
        dealsByMonth: a.byMonth,
        ppp: a.cur.length >= MIN_PPP_DEALS ? Math.round(median(a.cur)) : null,
        pppPrev: a.prev.length >= MIN_PPP_DEALS ? Math.round(median(a.prev)) : null,
        deals30: a.cur.length,
      };
    })
    .sort((x, y) => sumMonths(y.dealsByMonth) - sumMonths(x.dealsByMonth));

  // ── 이달 평단가 상위 거래 ─────────────────────────────────────────────
  const thisMonth = months[months.length - 1];
  const topDeals: ReportDeal[] = rows
    .filter((r) => r.deal_ym === thisMonth && Number(r.area) > 0)
    .map((r) => {
      const area = Number(r.area);
      const meta = REGION_BY_CODE.get(r.lawd_cd);
      return {
        aptSeq: r.apt_seq,
        aptNm: r.apt_nm,
        regionLabel: meta ? `${meta.sido} ${meta.name}` : r.lawd_cd,
        umdNm: r.umd_nm ?? '',
        area: Math.round(area * 10) / 10,
        pyeong: Math.round((area / PYEONG) * 10) / 10,
        amount: Number(r.amount),
        ppp: Math.round(Number(r.amount) / (area / PYEONG)),
        dealDate: r.deal_date,
        floor: r.floor == null ? null : Number(r.floor),
      };
    })
    .sort((a, b) => b.ppp - a.ppp)
    .slice(0, TOP_DEALS);

  // ── 전일 대비 ─────────────────────────────────────────────────────────
  const prevDate = reportDates().find((d) => d < date) ?? null;
  const prev = prevDate ? loadReport(prevDate) : null;
  const prevByCode = new Map((prev?.regions ?? []).map((r) => [r.lawdCd, r.dealsByMonth]));
  let newDeals: number | null = null;
  for (const r of regions) {
    const nd = newDealsOf(r.dealsByMonth, prevByCode.get(r.lawdCd));
    if (nd != null) newDeals = (newDeals ?? 0) + nd;
  }

  const rates = await fetchRates().catch((e) => {
    // 금리를 못 받아도 리포트는 낸다 — 없는 것보다 나머지가 있는 게 낫다
    console.log(`· ECOS 실패: ${e instanceof Error ? e.message : e} — 금리 블록 없이 진행`);
    return null;
  });

  const report: DailyReport = {
    date,
    generatedAt: new Date().toISOString(),
    months,
    prevDate,
    totals: {
      deals: rows.length,
      newDeals,
      regions: regions.length,
    },
    regions,
    topDeals,
    rates,
  };

  const json = JSON.stringify(report, null, 1);
  console.log(
    `· 지역 ${regions.length}곳 · 전일 대비 ${newDeals == null ? '비교 불가(첫 리포트)' : `${newDeals >= 0 ? '+' : ''}${newDeals.toLocaleString('ko-KR')}건`} · ${(json.length / 1024).toFixed(1)}KB`,
  );
  if (topDeals[0]) {
    console.log(
      `· 이달 최고 평단가 ${topDeals[0].ppp.toLocaleString('ko-KR')}만 — ${topDeals[0].regionLabel} ${topDeals[0].aptNm}`,
    );
  }

  if (dry) {
    console.log('(--dry: 파일을 쓰지 않았다)');
    return;
  }
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(join(REPORTS_DIR, `${date}.json`), json, 'utf8');
  console.log(`저장: content/reports/${date}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

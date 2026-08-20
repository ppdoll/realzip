import { NextResponse } from 'next/server';
import { regionLabel } from '@/data/regions';
import { FETCH_CONCURRENCY } from '@/lib/config';
import { recentMonths } from '@/lib/months';
import { getRegionTrades, pruneOldTrades, regionsByStaleness, storeMode } from '@/lib/store';
import { getRegionRents, pruneOldRents } from '@/lib/store-rent';

export const dynamic = 'force-dynamic';

/**
 * Hobby 플랜의 함수 상한이 60초다. 300 을 적어도 무효이므로 실제 상한에 맞춘다.
 * (Pro 이상이면 여기와 아래 TIME_BUDGET_MS 를 같이 올리면 된다.)
 */
export const maxDuration = 60;

/** 새 지역을 시작할지 판단하는 기준. 상한 60초에서 마무리 여유를 남긴다. */
const TIME_BUDGET_MS = 45_000;

/**
 * 한 지역을 마치는 데 필요하다고 보는 최소 여유.
 * 실측 지역당 약 0.6초(서울 기준)라 4초는 넉넉한 안전 마진이다 —
 * 도중에 잘리는 것보다 다음 실행에 넘기는 게 낫다.
 */
const MIN_SLOT_MS = 4_000;

/**
 * 한 번에 도는 지역 수 상한.
 * 실제로 멈추는 기준은 시간 예산이고(45초 ÷ 0.6초 ≈ 70곳), 이 값은
 * 공공데이터포털 일일 트래픽(지역당 3회 호출)에 대한 안전장치다.
 */
const MAX_REGIONS_PER_RUN = 80;

/** 갱신 대상 기간 — 실거래 신고 기한이 계약일로부터 30일이라 최근 몇 달이 계속 늘어난다. */
const REFRESH_MONTHS = 3;

/**
 * GET /api/cron/refresh
 *
 * 이미 조회한 적 있는 시군구의 최근 3개월치를 다시 받아 늦게 들어온 신고를 반영한다.
 *
 * 지역이 늘어나면 한 번에 다 돌 수 없다(Hobby 60초). 그래서
 *  · **갱신이 가장 오래된 지역부터** 돌고
 *  · 시간 예산이 떨어지면 멈추고 남은 지역은 다음 실행에 넘긴다.
 * 커서 테이블 없이 ingest_log.fetched_at 순서를 쓰기 때문에, 중간에 끊겨도
 * 다음 실행이 자연히 뒤에서 이어받는다.
 *
 * 수동 실행 시 ?limit=N 으로 지역 수를, ?budgetMs=N 으로 시간 예산을 줄일 수 있다
 * (둘 다 기본값보다 크게는 못 잡는다).
 *
 * Vercel Cron 이 호출하며, CRON_SECRET 이 설정되어 있으면
 * Authorization: Bearer <CRON_SECRET> 헤더를 검사한다.
 */
export async function GET(req: Request) {
  const startedAt = Date.now();

  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  if (storeMode() !== 'supabase') {
    return NextResponse.json({
      skipped: true,
      reason: 'Supabase 미설정 — 메모리 모드에서는 갱신할 대상이 없습니다.',
    });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit'));
  const maxRegions =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_REGIONS_PER_RUN)
      : MAX_REGIONS_PER_RUN;

  const budgetParam = Number(url.searchParams.get('budgetMs'));
  const timeBudget =
    Number.isFinite(budgetParam) && budgetParam > 0
      ? Math.min(budgetParam, TIME_BUDGET_MS)
      : TIME_BUDGET_MS;
  // 예산을 아주 작게 준 수동 실행에서도 최소 한 곳은 시도해 보게 한다.
  const minSlot = Math.min(MIN_SLOT_MS, Math.floor(timeBudget / 2));

  const months = recentMonths(REFRESH_MONTHS);
  const from = months[0];
  const to = months[months.length - 1];

  let queue: { lawdCd: string; oldestFetchedAt: number }[];
  try {
    queue = await regionsByStaleness(months);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const results: {
    lawdCd: string;
    label: string;
    trades?: number;
    rents?: number;
    staleHours: number;
    ms: number;
    error?: string;
    rentError?: string;
  }[] = [];
  let budgetHit = false;
  /**
   * 전월세는 매매와 별도 활용신청이 필요하고, 표도 따로 만들어야 한다.
   * 둘 중 하나가 안 되어 있으면 지역마다 똑같이 실패하므로, 한 번 확인하면
   * 이번 실행에서는 더 시도하지 않는다.
   */
  let rentDisabledReason: string | null = null;

  for (const item of queue) {
    if (results.length >= maxRegions) break;

    const spent = Date.now() - startedAt;
    // 남은 예산으로 한 지역을 마칠 수 없으면 시작하지 않는다 — 도중에 잘리는 게 더 나쁘다.
    if (timeBudget - spent < minSlot) {
      budgetHit = true;
      break;
    }

    const t0 = Date.now();
    const staleHours = Math.round(((t0 - item.oldestFetchedAt) / 3_600_000) * 10) / 10;
    try {
      const r = await getRegionTrades(item.lawdCd, from, to, {
        concurrency: FETCH_CONCURRENCY,
        force: true,
      });

      let rents: number | undefined;
      let rentError: string | undefined;
      if (rentDisabledReason === null) {
        try {
          const rr = await getRegionRents(item.lawdCd, from, to, {
            concurrency: FETCH_CONCURRENCY,
            force: true,
          });
          rents = rr.rents.length;
        } catch (e) {
          rentError = e instanceof Error ? e.message : String(e);
          // 활용신청 문제면 이번 실행 내내 전월세를 건너뛴다
          // 활용신청 미완 / 표 미생성 — 지역마다 반복해도 결과가 같다
          if (/활용신청|등록되지 않은|테이블이 없습니다/.test(rentError)) {
            rentDisabledReason = rentError;
          }
        }
      } else {
        rentError = '건너뜀 (전월세 미설정)';
      }

      results.push({
        lawdCd: item.lawdCd,
        label: regionLabel(item.lawdCd),
        trades: r.trades.length,
        rents,
        staleHours,
        ms: Date.now() - t0,
        rentError,
      });
    } catch (e) {
      results.push({
        lawdCd: item.lawdCd,
        label: regionLabel(item.lawdCd),
        staleHours,
        ms: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 매매(3년)·전월세(1년) 둘 다 창이 매달 굴러간다 — 정리하지 않으면 무한정 늘어난다.
  let pruned: {
    trade: { cutoff: string; trades: number; logs: number } | null;
    rent: { cutoff: string; trades: number; logs: number } | null;
  } = { trade: null, rent: null };
  let pruneError: string | null = null;
  if (results.length > 0) {
    try {
      pruned.trade = await pruneOldTrades();
      if (results.some((r) => r.rents != null)) pruned.rent = await pruneOldRents();
    } catch (e) {
      pruneError = e instanceof Error ? e.message : String(e);
    }
  }

  const done = new Set(results.map((r) => r.lawdCd));
  const remaining = queue.filter((q) => !done.has(q.lawdCd)).map((q) => q.lawdCd);

  return NextResponse.json({
    months,
    timeBudgetMs: timeBudget,
    totalRegions: queue.length,
    refreshed: results.length,
    failed: results.filter((r) => r.error).length,
    /** 전월세가 미신청이면 그 사유 (이번 실행에서 전월세는 전부 건너뜀) */
    rentDisabledReason,
    /** 창(매매 3년 · 전월세 1년)을 벗어나 지운 행 — 매달 굴러가므로 계속 정리해야 한다 */
    pruned,
    pruneError,
    remaining: remaining.length,
    /** 예산이 떨어져 멈췄는지 — true 면 남은 지역은 다음 실행에서 처리된다 */
    budgetHit,
    elapsedMs: Date.now() - startedAt,
    results,
    remainingRegions: remaining.slice(0, 20).map((c) => regionLabel(c)),
  });
}

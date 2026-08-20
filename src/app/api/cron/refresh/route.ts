import { NextResponse } from 'next/server';
import { FETCH_CONCURRENCY } from '@/lib/config';
import { recentMonths } from '@/lib/months';
import { getRegionTrades, storeMode } from '@/lib/store';
import { serverClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/refresh
 *
 * 이미 한 번이라도 조회한 시군구의 최근 3개월치를 다시 받아 최신 신고를 반영한다.
 * (실거래 신고 기한이 계약일로부터 30일이라, 지난달 데이터도 계속 늘어난다.)
 *
 * Vercel Cron 이 호출하며, CRON_SECRET 이 설정되어 있으면
 * Authorization: Bearer <CRON_SECRET> 헤더를 검사한다.
 */
export async function GET(req: Request) {
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

  const db = serverClient();

  // 지금까지 수집된 시군구 목록
  const { data, error } = await db.from('ingest_log').select('lawd_cd');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const regions = [...new Set((data ?? []).map((r) => r.lawd_cd as string))];

  const months = recentMonths(3);
  const from = months[0];
  const to = months[months.length - 1];

  const results: { lawdCd: string; trades?: number; error?: string }[] = [];
  for (const lawdCd of regions) {
    try {
      // ingest_log 의 최근 3개월 기록을 지워 강제로 다시 받게 한다.
      await db.from('ingest_log').delete().eq('lawd_cd', lawdCd).in('deal_ym', months);
      const r = await getRegionTrades(lawdCd, from, to, { concurrency: FETCH_CONCURRENCY });
      results.push({ lawdCd, trades: r.trades.length });
    } catch (e) {
      results.push({ lawdCd, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ refreshed: results.length, months, results });
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { FETCH_CONCURRENCY, MAX_COMPLEXES, WINDOW_MONTHS } from '@/lib/config';
import { buildRegionIndex, summarizeComplexes } from '@/lib/estimate';
import { recentMonths } from '@/lib/months';
import { getRegionTrades } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Query = z.object({
  lawdCd: z.string().regex(/^\d{5}$/, '시군구 코드는 5자리 숫자입니다.'),
  q: z.string().trim().max(40).optional(),
});

/**
 * GET /api/search?lawdCd=11680&q=은마
 *
 * 시군구의 최근 3년 거래를 확보하고(없으면 국토부에서 수집) 단지 목록 + 지역 가격지수를 반환한다.
 * 처음 조회하는 시군구는 36개월치를 받아오므로 10~30초가 걸릴 수 있다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    lawdCd: url.searchParams.get('lawdCd') ?? '',
    q: url.searchParams.get('q') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '잘못된 요청입니다.' },
      { status: 400 },
    );
  }
  const { lawdCd, q } = parsed.data;
  if (!REGION_BY_CODE.has(lawdCd)) {
    return NextResponse.json({ error: '지원하지 않는 시군구 코드입니다.' }, { status: 400 });
  }

  const months = recentMonths(WINDOW_MONTHS);
  const from = months[0];
  const to = months[months.length - 1];

  try {
    const data = await getRegionTrades(lawdCd, from, to, {
      concurrency: FETCH_CONCURRENCY,
    });

    const index = buildRegionIndex(data.trades, from, to);
    let complexes = summarizeComplexes(data.trades);

    if (q) {
      const needle = q.replace(/\s+/g, '').toLowerCase();
      complexes = complexes.filter(
        (c) =>
          c.aptNm.replace(/\s+/g, '').toLowerCase().includes(needle) ||
          c.umdNm.replace(/\s+/g, '').toLowerCase().includes(needle),
      );
    }

    const truncated = complexes.length > MAX_COMPLEXES;

    return NextResponse.json({
      region: { code: lawdCd, label: regionLabel(lawdCd) },
      window: { from, to, months: months.length },
      totalTrades: data.trades.length,
      index,
      complexes: complexes.slice(0, MAX_COMPLEXES),
      truncated,
      meta: {
        mode: data.mode,
        fetchedMonths: data.fetchedMonths,
        errors: data.errors,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

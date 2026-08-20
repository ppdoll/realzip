import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { FETCH_CONCURRENCY, WINDOW_MONTHS } from '@/lib/config';
import { areaOptions, buildRegionIndex, estimate } from '@/lib/estimate';
import { recentMonths } from '@/lib/months';
import { filterComplex, getRegionTrades } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Query = z.object({
  lawdCd: z.string().regex(/^\d{5}$/),
  aptSeq: z.string().min(1).max(200),
  area: z.coerce.number().positive().max(1000).optional(),
  floor: z.coerce.number().int().min(-5).max(100).optional(),
});

/**
 * GET /api/complex?lawdCd=11680&aptSeq=11680-1234&area=84.97&floor=12
 *
 * 단지 1곳의 최근 3년 실거래 내역 + 지역 가격지수 + 예상 실거래가를 반환한다.
 * area 를 넘기지 않으면 거래가 가장 많은 평형으로 계산한다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    lawdCd: url.searchParams.get('lawdCd') ?? '',
    aptSeq: url.searchParams.get('aptSeq') ?? '',
    area: url.searchParams.get('area') ?? undefined,
    floor: url.searchParams.get('floor') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const { lawdCd, aptSeq } = parsed.data;
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
    const complexTrades = filterComplex(data.trades, aptSeq);
    if (complexTrades.length === 0) {
      return NextResponse.json(
        { error: '해당 단지의 최근 3년 거래를 찾지 못했습니다.' },
        { status: 404 },
      );
    }

    const areas = areaOptions(complexTrades);
    const targetArea = parsed.data.area ?? areas[0]?.area;
    if (!targetArea) {
      return NextResponse.json({ error: '면적 정보를 찾지 못했습니다.' }, { status: 404 });
    }

    const index = buildRegionIndex(data.trades, from, to);
    const est = estimate({
      regionTrades: data.trades,
      complexTrades,
      index,
      area: targetArea,
      floor: parsed.data.floor ?? null,
    });

    const head = complexTrades[complexTrades.length - 1];

    return NextResponse.json({
      region: { code: lawdCd, label: regionLabel(lawdCd) },
      complex: {
        aptSeq,
        aptNm: head.aptNm,
        umdNm: head.umdNm,
        jibun: head.jibun,
        roadNm: head.roadNm,
        buildYear: head.buildYear,
      },
      window: { from, to },
      areas,
      selectedArea: targetArea,
      estimate: est,
      index,
      trades: [...complexTrades].sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1)),
      meta: { mode: data.mode, fetchedMonths: data.fetchedMonths, errors: data.errors },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

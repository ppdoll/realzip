import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { FETCH_CONCURRENCY, WINDOW_MONTHS } from '@/lib/config';
import { compareListings, parseListings } from '@/lib/compare';
import { areaOptions, buildRegionIndex } from '@/lib/estimate';
import { recentMonths } from '@/lib/months';
import { filterComplex, getRegionTrades } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({
  lawdCd: z.string().regex(/^\d{5}$/),
  aptSeq: z.string().min(1).max(200),
  /** 면적이 안 적힌 매물에 적용할 기본 전용면적 */
  area: z.number().positive().max(1000).optional(),
  /** 붙여넣은 호가 텍스트 (한 줄에 매물 하나) */
  text: z.string().min(1).max(20_000),
});

/**
 * POST /api/compare
 *
 * 사용자가 보고 있는 매물 호가를 받아 같은 모델로 그 면적·층의 추정가를 계산해 대조한다.
 * 호가 자체는 어떤 공개 API 로도 받아올 수 없어서(공공데이터는 실거래가만 제공,
 * 네이버부동산은 공식 API 없음) 입력을 받는 구조가 유일한 합법적인 경로다.
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문입니다.' }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '잘못된 요청입니다.' },
      { status: 400 },
    );
  }
  const { lawdCd, aptSeq, text } = parsed.data;
  if (!REGION_BY_CODE.has(lawdCd)) {
    return NextResponse.json({ error: '지원하지 않는 시군구 코드입니다.' }, { status: 400 });
  }

  const listings = parseListings(text);
  if (listings.length === 0) {
    return NextResponse.json({ error: '읽을 수 있는 줄이 없습니다.' }, { status: 400 });
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
    const defaultArea = parsed.data.area ?? areas[0]?.area;
    if (!defaultArea) {
      return NextResponse.json({ error: '면적 정보를 찾지 못했습니다.' }, { status: 404 });
    }

    const index = buildRegionIndex(data.trades, from, to);
    const result = compareListings({
      regionTrades: data.trades,
      complexTrades,
      index,
      defaultArea,
      listings,
    });

    return NextResponse.json({
      region: { code: lawdCd, label: regionLabel(lawdCd) },
      defaultArea,
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

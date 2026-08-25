import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { loadRegionIndex } from '@/lib/region-index';
import { storeMode } from '@/lib/store';

export const dynamic = 'force-dynamic';

const Query = z.object({ lawdCd: z.string().regex(/^\d{5}$/) });

/**
 * GET /api/region-index?lawdCd=11680
 *
 * 지역의 장기(최대 10년) 월별 평단가 요약. 원본 거래는 3년만 들고 있지만
 * 이 표는 집계만 남겨 두어서 그보다 긴 과거를 가진다 — 자세한 이유는
 * src/lib/region-index.ts 주석에 있다.
 *
 * 아직 안 쌓은 지역은 빈 배열을 준다. 오류가 아니라 "아직 없음" 이다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({ lawdCd: url.searchParams.get('lawdCd') ?? '' });
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const { lawdCd } = parsed.data;
  if (!REGION_BY_CODE.has(lawdCd)) {
    return NextResponse.json({ error: '지원하지 않는 시군구 코드입니다.' }, { status: 400 });
  }
  if (storeMode() !== 'supabase') {
    return NextResponse.json({ region: { code: lawdCd, label: regionLabel(lawdCd) }, points: [] });
  }

  try {
    const rows = await loadRegionIndex(lawdCd);
    return NextResponse.json({
      region: { code: lawdCd, label: regionLabel(lawdCd), name: REGION_BY_CODE.get(lawdCd)?.name },
      points: rows.map((r) => ({
        ym: r.dealYm,
        ppp: r.pppMedian,
        p25: r.pppP25,
        p75: r.pppP75,
        deals: r.deals,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

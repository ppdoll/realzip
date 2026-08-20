import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { recentMonths } from '@/lib/months';
import { SEOUL_CODES, regionStatsFor, type RegionStat } from '@/lib/region-stats';
import {
  AREA_TOLERANCE,
  PRICE_TOLERANCE,
  findSimilar,
  type CandidateTrade,
} from '@/lib/similar';
import { storeMode } from '@/lib/store';
import { fetchAllPaged, serverClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Query = z.object({
  lawdCd: z.string().regex(/^\d{5}$/),
  aptSeq: z.string().min(1).max(200),
  area: z.coerce.number().positive().max(1000),
  /** 기준 금액 (만원) — 상세 화면의 예상 실거래가 */
  price: z.coerce.number().positive().max(50_000_000),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

type Row = {
  lawd_cd: string;
  apt_seq: string;
  apt_nm: string;
  umd_nm: string;
  build_year: number | null;
  area: number;
  floor: number | null;
  amount: number;
  deal_date: string;
};

/**
 * GET /api/similar?lawdCd=11680&aptSeq=11680-218&area=84.43&price=394300
 *
 * "이 가격대로 살 수 있는 서울 아파트" — 기준 면적·금액에 가까운 서울 단지를 찾아
 * 각 단지가 속한 **지역 정보(중위 평단가·거래량·1년 변동)** 를 함께 돌려준다.
 *
 * 서울 25개 구를 전부 뒤지지만, 후보를 SQL 에서 면적 ±7% · 금액 ±15% · 최근 12개월로
 * 좁히기 때문에 실측 500행 안쪽만 메모리로 올라온다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    lawdCd: url.searchParams.get('lawdCd') ?? '',
    aptSeq: url.searchParams.get('aptSeq') ?? '',
    area: url.searchParams.get('area') ?? '',
    price: url.searchParams.get('price') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const { lawdCd, aptSeq, area, price } = parsed.data;
  if (!REGION_BY_CODE.has(lawdCd)) {
    return NextResponse.json({ error: '지원하지 않는 시군구 코드입니다.' }, { status: 400 });
  }
  if (storeMode() !== 'supabase') {
    return NextResponse.json(
      {
        error:
          '이 기능은 Supabase 가 필요합니다 — 서울 전체를 훑어야 해서 메모리 캐시로는 동작하지 않습니다.',
      },
      { status: 503 },
    );
  }

  const from = recentMonths(12)[0];

  try {
    const rows = await fetchAllPaged<Row>(
      () =>
        serverClient()
          .from('apt_trade')
          .select('lawd_cd, apt_seq, apt_nm, umd_nm, build_year, area, floor, amount, deal_date')
          .in('lawd_cd', SEOUL_CODES)
          .gte('deal_ym', from)
          .eq('canceled', false)
          .gte('area', area * (1 - AREA_TOLERANCE))
          .lte('area', area * (1 + AREA_TOLERANCE))
          .gte('amount', Math.round(price * (1 - PRICE_TOLERANCE)))
          .lte('amount', Math.round(price * (1 + PRICE_TOLERANCE))),
      { label: '유사 단지 후보 조회' },
    );

    const candidates: CandidateTrade[] = rows.map((r) => ({
      lawdCd: r.lawd_cd,
      aptSeq: r.apt_seq,
      aptNm: r.apt_nm,
      umdNm: r.umd_nm ?? '',
      buildYear: r.build_year == null ? null : Number(r.build_year),
      area: Number(r.area),
      floor: r.floor == null ? null : Number(r.floor),
      amount: Number(r.amount),
      dealDate: String(r.deal_date),
    }));

    const items = findSimilar({
      candidates,
      area,
      price,
      excludeAptSeq: aptSeq,
      limit: parsed.data.limit ?? 12,
    });

    // 추천에 실제로 등장한 지역만 계산한다 (서울 25개 구를 다 하면 36개월 198,000행)
    const needed = [...new Set(items.map((i) => i.lawdCd))];
    const stats = await regionStatsFor(needed);
    const regions: Record<string, RegionStat> = {};
    for (const code of needed) {
      const s = stats.get(code);
      if (s) regions[code] = s;
    }

    return NextResponse.json({
      base: {
        lawdCd,
        label: regionLabel(lawdCd),
        aptSeq,
        area,
        price,
      },
      window: { from, months: 12 },
      tolerance: {
        areaPct: Math.round(AREA_TOLERANCE * 1000) / 10,
        pricePct: Math.round(PRICE_TOLERANCE * 1000) / 10,
      },
      candidateTrades: rows.length,
      items,
      regions,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

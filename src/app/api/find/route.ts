import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { m22py } from '@/lib/area-bands';
import { recentMonths } from '@/lib/months';
import { storeMode } from '@/lib/store';
import { fetchAllPaged, serverClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SORTS = ['price_asc', 'price_desc', 'ppa_asc', 'ppa_desc', 'deals_desc', 'recent'] as const;

const Query = z.object({
  /** 시군구 코드 (쉼표 구분) */
  codes: z.string().min(5).max(2000),
  /** 전용면적 범위 (㎡) */
  areaMin: z.coerce.number().min(0).max(1000),
  areaMax: z.coerce.number().min(1).max(1000),
  /** 금액 범위 (만원) */
  priceMin: z.coerce.number().int().min(0).max(50_000_000),
  priceMax: z.coerce.number().int().min(1).max(50_000_000),
  /** 최소 거래 건수 — 중위값의 신뢰도 */
  minDeals: z.coerce.number().int().min(1).max(50).default(1),
  /** 준공년도 범위 — 비우면 제한 없음 */
  yearMin: z.coerce.number().int().min(1900).max(2100).optional(),
  yearMax: z.coerce.number().int().min(1900).max(2100).optional(),
  months: z.coerce.number().int().min(1).max(36).default(12),
  sort: z.enum(SORTS).default('price_asc'),
  limit: z.coerce.number().int().min(1).max(300).default(100),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

type Row = {
  lawd_cd: string;
  apt_seq: string;
  apt_nm: string;
  umd_nm: string | null;
  build_year: number | null;
  area: number;
  area_min: number;
  area_max: number;
  price: number;
  deal_count: number;
  min_amount: number;
  max_amount: number;
  last_deal: string;
  total_rows: number;
};

/** 담아둔 시군구만 검색 대상이다 — 없는 지역을 조건에 넣으면 조용히 0건이 된다 */
let cachedCodes: { at: number; codes: string[] } | null = null;
async function ingestedCodes(): Promise<string[]> {
  if (cachedCodes && Date.now() - cachedCodes.at < 10 * 60 * 1000) return cachedCodes.codes;
  const rows = await fetchAllPaged<{ lawd_cd: string }>(
    () => serverClient().from('ingest_log').select('lawd_cd'),
    { label: 'ingest_log 조회' },
  );
  const codes = [...new Set(rows.map((r) => r.lawd_cd))].filter((c) => REGION_BY_CODE.has(c)).sort();
  cachedCodes = { at: Date.now(), codes };
  return codes;
}

/**
 * GET /api/find?codes=11680,11650&areaMin=66&areaMax=99&priceMin=50000&priceMax=80000
 *
 * 지역·평형·금액 조건으로 단지·평형 목록을 뽑는다.
 *
 * 집계는 **DB 안에서** 한다 (`search_complexes`). 노드로 행을 끌어와 집계하면
 * 실측 63개 지역·15~50평·3~20억 조건이 175,280행 18.1초였고, 같은 조건이
 * 함수로는 0.58초다. 여기서 필요한 건 단지·평형별 한 줄이라 DB 가 접는 게 맞다.
 *
 * 금액 조건은 개별 거래가 아니라 **단지·평형의 중위값**에 걸린다 — 자세한 이유는
 * schema.sql 의 함수 주석에 적어 두었다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '잘못된 요청입니다.', detail: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }
  const q = parsed.data;
  if (q.areaMin >= q.areaMax) {
    return NextResponse.json({ error: '면적 범위가 뒤집혀 있습니다.' }, { status: 400 });
  }
  if (q.priceMin >= q.priceMax) {
    return NextResponse.json({ error: '금액 범위가 뒤집혀 있습니다.' }, { status: 400 });
  }
  if (q.yearMin != null && q.yearMax != null && q.yearMin > q.yearMax) {
    return NextResponse.json({ error: '준공년도 범위가 뒤집혀 있습니다.' }, { status: 400 });
  }
  if (storeMode() !== 'supabase') {
    return NextResponse.json(
      { error: '조건 검색은 Supabase 가 필요합니다 — 여러 지역을 한 번에 훑기 때문입니다.' },
      { status: 503 },
    );
  }

  const asked = [...new Set(q.codes.split(',').map((c) => c.trim()).filter(Boolean))];
  const available = await ingestedCodes();
  const codes = asked.filter((c) => available.includes(c));
  // 담아두지 않은 지역을 조용히 빼면 "그 지역에 없다" 로 읽힌다 — 무엇이 빠졌는지 알려준다
  const skipped = asked.filter((c) => !available.includes(c));
  if (codes.length === 0) {
    return NextResponse.json({
      items: [],
      total: 0,
      skipped: skipped.map((c) => ({ code: c, label: regionLabel(c) })),
      error:
        skipped.length > 0
          ? '고른 지역은 아직 데이터를 담지 않았습니다. 지역 목록에서 담아둔 곳을 골라주세요.'
          : '검색할 지역이 없습니다.',
    });
  }

  const months = recentMonths(q.months);
  const from = months[0];

  try {
    const { data, error } = await serverClient().rpc('search_complexes', {
      p_lawd_cds: codes,
      p_from_ym: from,
      p_area_min: q.areaMin,
      p_area_max: q.areaMax,
      p_price_min: q.priceMin,
      p_price_max: q.priceMax,
      p_min_deals: q.minDeals,
      p_year_min: q.yearMin ?? null,
      p_year_max: q.yearMax ?? null,
      p_sort: q.sort,
      p_limit: q.limit,
      p_offset: q.offset,
    });
    if (error) {
      // 함수가 아직 없는 경우를 알아보기 쉽게 바꿔 준다
      if (/search_complexes|function|schema cache/i.test(error.message)) {
        return NextResponse.json(
          {
            error:
              '조건 검색 함수가 DB 에 없습니다. src/lib/schema.sql 의 search_complexes 부분을 ' +
              'Supabase SQL Editor 에서 실행하거나 npm run db:setup 을 다시 돌려주세요. (' +
              error.message +
              ')',
          },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }

    const rows = (data ?? []) as Row[];
    const total = rows.length > 0 ? Number(rows[0].total_rows) : 0;

    return NextResponse.json({
      window: { from, months: q.months },
      query: {
        codes,
        areaMin: q.areaMin,
        areaMax: q.areaMax,
        pyMin: m22py(q.areaMin),
        pyMax: m22py(q.areaMax),
        priceMin: q.priceMin,
        priceMax: q.priceMax,
        minDeals: q.minDeals,
        yearMin: q.yearMin ?? null,
        yearMax: q.yearMax ?? null,
        sort: q.sort,
      },
      total,
      offset: q.offset,
      skipped: skipped.map((c) => ({ code: c, label: regionLabel(c) })),
      items: rows.map((r) => ({
        lawdCd: r.lawd_cd,
        regionLabel: REGION_BY_CODE.get(r.lawd_cd)?.name ?? r.lawd_cd,
        aptSeq: r.apt_seq,
        aptNm: r.apt_nm,
        umdNm: r.umd_nm ?? '',
        buildYear: r.build_year == null ? null : Number(r.build_year),
        area: Number(r.area),
        /** 이 묶음에 든 전용면적 범위 — 타입이 여럿이면 같지 않다 (121.5~121.7 처럼) */
        areaMin: Number(r.area_min),
        areaMax: Number(r.area_max),
        pyeong: m22py(Number(r.area)),
        price: Number(r.price),
        dealCount: Number(r.deal_count),
        minAmount: Number(r.min_amount),
        maxAmount: Number(r.max_amount),
        lastDeal: String(r.last_deal),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

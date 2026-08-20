import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE, regionLabel } from '@/data/regions';
import { FETCH_CONCURRENCY, RENT_WINDOW_MONTHS, WINDOW_MONTHS } from '@/lib/config';
import { areaOptions } from '@/lib/estimate';
import { recentMonths } from '@/lib/months';
import { filterComplexRents, summarizeRent } from '@/lib/rent';
import { filterComplex, getRegionTrades } from '@/lib/store';
import { getRegionRents } from '@/lib/store-rent';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Query = z.object({
  lawdCd: z.string().regex(/^\d{5}$/),
  aptSeq: z.string().min(1).max(200),
  area: z.coerce.number().positive().max(1000).optional(),
  floor: z.coerce.number().int().min(-5).max(100).optional(),
  /** 전세가율 계산용 매매 추정가 (만원). 화면이 이미 갖고 있으면 넘겨서 재계산을 아낀다 */
  salePrice: z.coerce.number().positive().optional(),
});

/**
 * GET /api/rent?lawdCd=11680&aptSeq=11680-218&area=84.43&salePrice=352120
 *
 * 단지 1곳의 **최근 1년** 전월세 내역 + 전세 추정 보증금 + 전세가율을 반환한다.
 * (매매는 3년, 전월세는 1년 — 전월세 신고량이 5배 가까이 많아 저장 비용이 크다.)
 * 화면에서 매매와 **병렬로** 호출하도록 별도 엔드포인트로 두었다 —
 * 전월세를 매매 응답에 합치면 단지 조회가 통째로 느려진다.
 *
 * 전월세 자료는 매매와 별도로 활용신청해야 하므로, 미신청이면 안내 메시지를 담아
 * 200 이 아닌 502 로 응답한다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    lawdCd: url.searchParams.get('lawdCd') ?? '',
    aptSeq: url.searchParams.get('aptSeq') ?? '',
    area: url.searchParams.get('area') ?? undefined,
    floor: url.searchParams.get('floor') ?? undefined,
    salePrice: url.searchParams.get('salePrice') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const { lawdCd, aptSeq } = parsed.data;
  if (!REGION_BY_CODE.has(lawdCd)) {
    return NextResponse.json({ error: '지원하지 않는 시군구 코드입니다.' }, { status: 400 });
  }

  // 매매는 3년, 전월세는 1년 창을 쓴다 (config 의 두 상수)
  const saleMonths = recentMonths(WINDOW_MONTHS);
  const saleFrom = saleMonths[0];
  const rentMonths = recentMonths(RENT_WINDOW_MONTHS);
  const from = rentMonths[0];
  const to = rentMonths[rentMonths.length - 1];

  try {
    // 단지 식별자(법정동·단지명·지번)는 매매 쪽에만 있으므로 먼저 거기서 얻는다.
    // 이미 적재된 지역이면 DB 조회라 값이 싸다.
    const saleData = await getRegionTrades(lawdCd, saleFrom, to, {
      concurrency: FETCH_CONCURRENCY,
    });
    const complexTrades = filterComplex(saleData.trades, aptSeq);
    if (complexTrades.length === 0) {
      return NextResponse.json(
        { error: '해당 단지의 최근 3년 매매 거래를 찾지 못했습니다.' },
        { status: 404 },
      );
    }
    const head = complexTrades[complexTrades.length - 1];
    const targetArea = parsed.data.area ?? areaOptions(complexTrades)[0]?.area;
    if (!targetArea) {
      return NextResponse.json({ error: '면적 정보를 찾지 못했습니다.' }, { status: 404 });
    }

    // 시군구 전월세는 매매보다 훨씬 많다(강남구 3년 69,026행). 전부 끌어오면 느리고
    // 절단 위험도 커지므로 필요한 두 조각만 서버에서 걸러 받는다.
    //   1) 이 단지의 전월세 전체 (전세·월세 모두 — 표와 최근 계약 표시용)
    //   2) 지수 산출용 시군구 전세만, 축소 컬럼으로
    const rentData = await getRegionRents(lawdCd, from, to, {
      concurrency: FETCH_CONCURRENCY,
      query: { umdNm: head.umdNm, aptNm: head.aptNm },
    });
    const complexRents = filterComplexRents(rentData.rents, {
      umdNm: head.umdNm,
      aptNm: head.aptNm,
      jibun: head.jibun,
    });

    const regionJeonse = await getRegionRents(lawdCd, from, to, {
      onlyCached: true, // 위에서 이미 수집했다
      query: { jeonseOnly: true, slim: true },
    });

    const summary = summarizeRent({
      regionRents: regionJeonse.rents,
      complexRents,
      from,
      to,
      area: targetArea,
      floor: parsed.data.floor ?? null,
      salePrice: parsed.data.salePrice ?? null,
    });

    return NextResponse.json({
      region: { code: lawdCd, label: regionLabel(lawdCd) },
      complex: { aptSeq, aptNm: head.aptNm, umdNm: head.umdNm, jibun: head.jibun },
      window: { from, to, months: rentMonths.length },
      selectedArea: targetArea,
      summary,
      /** 선택 평형의 전월세 내역 (최신순) */
      rents: [...complexRents]
        .filter((r) => Math.abs(r.area - targetArea) < 1.5)
        .sort((a, b) => (a.dealDate < b.dealDate ? 1 : -1)),
      /** 단지 전체(모든 평형) 전월세 건수 */
      complexRentCount: complexRents.length,
      meta: {
        mode: rentData.mode,
        fetchedMonths: rentData.fetchedMonths,
        errors: rentData.errors,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

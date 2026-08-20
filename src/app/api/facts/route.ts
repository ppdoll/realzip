import { NextResponse } from 'next/server';
import { z } from 'zod';
import { REGION_BY_CODE } from '@/data/regions';
import { WINDOW_MONTHS } from '@/lib/config';
import { buildComplexFacts, turnoverLabel } from '@/lib/complex-facts';
import { recentMonths } from '@/lib/months';
import { filterComplex, getRegionTrades, storeMode } from '@/lib/store';
import { position, regionTurnover, valuesOf } from '@/lib/region-metrics';
import { findKapt } from '@/lib/store-kapt';
import { serverClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Query = z.object({
  lawdCd: z.string().regex(/^\d{5}$/),
  aptSeq: z.string().min(1).max(200),
});

/**
 * GET /api/facts?lawdCd=11680&aptSeq=11680-218
 *
 * 단지 정보(세대수·준공일·난방 등)와, 그것을 내 거래 데이터와 곱해서 나오는 지표
 * (거래 회전율 · 전월세 신고율)를 돌려준다.
 *
 * 건수는 행을 끌어오지 않고 **집계 쿼리(head + count)** 로 센다 — 회전율에 필요한 건
 * 숫자뿐이라 수천 행을 옮길 이유가 없다.
 *
 * K-apt 는 의무관리대상(300세대 이상 등)만 담아서 소규모 단지는 아예 없다.
 * 못 찾으면 404 대신 `matched: false` 로 돌려주고 화면에서 카드를 접는다 —
 * 데이터가 없는 것은 오류가 아니다.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    lawdCd: url.searchParams.get('lawdCd') ?? '',
    aptSeq: url.searchParams.get('aptSeq') ?? '',
  });
  if (!parsed.success) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const { lawdCd, aptSeq } = parsed.data;
  if (!REGION_BY_CODE.has(lawdCd)) {
    return NextResponse.json({ error: '지원하지 않는 시군구 코드입니다.' }, { status: 400 });
  }
  if (storeMode() !== 'supabase') {
    return NextResponse.json({ matched: false, reason: 'memory-mode' });
  }

  const from12 = recentMonths(12)[0];

  try {
    // 단지 식별자(법정동·지번·이름)는 거래 데이터에서 얻는다
    const months = recentMonths(WINDOW_MONTHS);
    const sale = await getRegionTrades(lawdCd, months[0], months[months.length - 1], {
      onlyCached: true,
    });
    const complexTrades = filterComplex(sale.trades, aptSeq);
    if (complexTrades.length === 0) {
      return NextResponse.json({ matched: false, reason: 'no-trades' });
    }
    const head = complexTrades[complexTrades.length - 1];

    const kapt = await findKapt(lawdCd, head.umdNm, head.jibun, head.aptNm);
    if (!kapt) {
      return NextResponse.json({
        matched: false,
        reason: 'no-kapt',
        complex: { aptNm: head.aptNm, umdNm: head.umdNm, jibun: head.jibun },
      });
    }

    const db = serverClient();
    const [saleCount, rentCount] = await Promise.all([
      db
        .from('apt_trade')
        .select('*', { count: 'exact', head: true })
        .eq('lawd_cd', lawdCd)
        .eq('apt_seq', aptSeq)
        .eq('canceled', false)
        .gte('deal_ym', from12),
      db
        .from('apt_rent')
        .select('*', { count: 'exact', head: true })
        .eq('lawd_cd', lawdCd)
        .eq('umd_nm', head.umdNm)
        .eq('apt_nm', head.aptNm)
        .gte('deal_ym', from12),
    ]);

    const facts = buildComplexFacts({
      kapt,
      saleCount12m: saleCount.count ?? 0,
      rentCount12m: rentCount.count ?? 0,
    });

    // 회전율 0.9% 는 그 자체로 감이 오지 않는다 — 같은 구 분포 안에서의 위치를 붙인다.
    // 분포는 나와 똑같이 (거래건수 / K-apt 세대수) 로 계산한 값들이라 비교가 성립한다.
    let turnover = null;
    try {
      const region = await regionTurnover(lawdCd);
      turnover = position(facts.turnoverPct, region.distribution, valuesOf(region.byComplex));
    } catch {
      // 분포는 부가 정보다 — 못 구해도 단지 정보 자체는 보여준다
    }

    return NextResponse.json({
      matched: true,
      window: { from: from12, months: 12 },
      facts,
      turnoverLabel: turnoverLabel(facts.turnoverPct),
      turnover,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

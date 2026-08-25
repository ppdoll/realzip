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

    const kapt = await findKapt(lawdCd, head.umdNm, head.jibun, head.aptNm, head.buildYear);
    if (!kapt) {
      return NextResponse.json({
        matched: false,
        reason: 'no-kapt',
        complex: { aptNm: head.aptNm, umdNm: head.umdNm, jibun: head.jibun },
      });
    }

    /**
     * 세대수로 나누는 지표는 **단지 전체 거래**로 세야 한다.
     *
     * 실거래 자료는 한 단지를 블록으로 쪼개 보낸다 — 상계주공1이 (고층) 144건,
     * (저층) 6건으로 따로 온다. 세대수는 단지 전체(2,064세대) 하나뿐이라
     * 조각만 세면 저층이 6/2064 = 0.3% 가 되어 "손바뀜 거의 없는 단지" 로 읽힌다.
     * 실제 상계주공1은 7.2% 로 노원 상위권이다.
     *
     * 구 분포 계산이 이미 kaptCode 단위로 합쳐 두었으니 그 값을 그대로 쓴다 —
     * 화면의 숫자와 분포 안의 위치가 같은 계산에서 나와야 한다.
     */
    let regionTurn: Awaited<ReturnType<typeof regionTurnover>> | null = null;
    try {
      regionTurn = await regionTurnover(lawdCd);
    } catch {
      // 분포는 부가 정보다 — 못 구해도 단지 정보 자체는 보여준다
    }
    const entry = regionTurn?.byKapt.get(kapt.kaptCode) ?? null;
    const blockNames = entry && entry.blocks.length > 1 ? entry.blocks.map((b) => b.aptNm) : null;

    const db = serverClient();
    // 전월세도 같은 이유로 블록을 모두 합친다
    const rentNames = entry ? [...new Set(entry.blocks.map((b) => b.aptNm))] : [head.aptNm];
    const [saleCount, rentCount] = await Promise.all([
      entry
        ? Promise.resolve({ count: entry.sales })
        : db
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
        .in('apt_nm', rentNames)
        .gte('deal_ym', from12),
    ]);

    const facts = buildComplexFacts({
      kapt,
      saleCount12m: saleCount.count ?? 0,
      rentCount12m: rentCount.count ?? 0,
    });

    // 회전율 0.9% 는 그 자체로 감이 오지 않는다 — 같은 구 분포 안에서의 위치를 붙인다.
    const turnover = regionTurn
      ? position(facts.turnoverPct, regionTurn.distribution, valuesOf(regionTurn.byComplex))
      : null;

    return NextResponse.json({
      matched: true,
      window: { from: from12, months: 12 },
      facts,
      turnoverLabel: turnoverLabel(facts.turnoverPct),
      turnover,
      /** 실거래에서 쪼개져 온 블록들 — 합산했음을 화면에 밝히기 위해 */
      mergedBlocks: blockNames,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

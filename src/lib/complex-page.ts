import { REGION_BY_CODE } from '@/data/regions';
import { PYEONG, median, quantile } from './stats';
import { areaClusterer } from './area-bands';
import { buildComplexFacts, turnoverLabel, type ComplexFacts } from './complex-facts';
import { recentMonths } from './months';
import { loadRegionIndex, type RegionIndexRow } from './region-index';
import { position, regionJeonseRatios, regionTurnover, valuesOf, type Positioned } from './region-metrics';
import { findKapt } from './store-kapt';
import { fetchAllPaged, serverClient } from './supabase';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  단지 페이지에 필요한 것만 모아 온다 (검색 노출용 정적 페이지)
 * ────────────────────────────────────────────────────────────────────────
 *
 *  **지역 전체를 끌어오지 않는다.** 화면(AppShell)은 지역 36개월치를 다 받아서
 *  회귀 추정을 만드는데, 강남구 하나가 3만 행이다. 단지 10,941개 페이지를 그렇게
 *  만들면 감당할 수 없다. 여기서는 apt_trade_complex_idx (apt_seq, deal_date) 를
 *  타고 그 단지만 읽는다 — 실측 84~127ms.
 *
 *  **예상 시세(회귀 추정)는 넣지 않는다.** 그것은 지역 가격지수가 있어야 나오고,
 *  지역 지수는 지역 전체 거래로 만든다. 여기서 더 약한 방법으로 비슷한 숫자를
 *  만들어 같은 것처럼 보여주면 안 된다 — 페이지는 **사실**(실거래 내역, 평형별
 *  중위값, 단지 정보, 구 분포 안의 위치, 장기 흐름)만 담고, 추정은 앱으로 넘긴다.
 */

export type AreaGroup = {
  /** 대표 전용면적 (묶음 평균) */
  area: number;
  areaMin: number;
  areaMax: number;
  pyeong: number;
  /** 최근 1년 중위 거래금액 (만원) */
  price: number;
  low: number;
  high: number;
  deals: number;
  lastDeal: string;
  pricePerPyeong: number;
};

export type TradeRow = {
  dealDate: string;
  area: number;
  floor: number | null;
  amount: number;
  dealingGbn: string | null;
};

export type ComplexPageData = {
  lawdCd: string;
  regionName: string;
  regionLabel: string;
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  jibun: string | null;
  buildYear: number | null;
  /** 최근 1년 평형별 요약 — 거래가 많은 평형 순 */
  areas: AreaGroup[];
  /** 최근 거래 내역 (최신순, 최대 40건) */
  recent: TradeRow[];
  deals12m: number;
  facts: ComplexFacts | null;
  turnoverLabel: string | null;
  turnover: Positioned | null;
  jeonseRatio: Positioned | null;
  longTerm: RegionIndexRow[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** 페이지에 쓸 자료. 거래가 없으면 null (페이지를 만들지 않는다) */
export async function loadComplexPage(aptSeq: string): Promise<ComplexPageData | null> {
  const lawdCd = aptSeq.split('-')[0];
  const region = REGION_BY_CODE.get(lawdCd);
  if (!region) return null;

  const db = serverClient();
  const from12 = recentMonths(12)[0];

  // 이 단지 거래만 읽는다 (apt_seq 인덱스)
  const trades = await fetchAllPaged<{
    apt_nm: string;
    umd_nm: string | null;
    jibun: string | null;
    build_year: number | null;
    area: number;
    floor: number | null;
    amount: number;
    deal_date: string;
    deal_ym: string;
    dealing_gbn: string | null;
  }>(
    () =>
      db
        .from('apt_trade')
        .select('apt_nm, umd_nm, jibun, build_year, area, floor, amount, deal_date, deal_ym, dealing_gbn')
        .eq('apt_seq', aptSeq)
        .eq('canceled', false)
        .order('deal_date', { ascending: false }),
    { label: '단지 거래 조회', hardLimit: 20_000 },
  );
  if (trades.length === 0) return null;

  const head = trades[0];
  const recent12 = trades.filter((t) => t.deal_ym >= from12);

  // 평형 묶기는 화면과 같은 규칙을 쓴다 (1.5㎡ 안쪽은 한 타입)
  const clusterOf = areaClusterer(trades.map((t) => Number(t.area)));
  const groups = new Map<number, typeof recent12>();
  for (const t of recent12) {
    const k = clusterOf(Number(t.area));
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }

  const areas: AreaGroup[] = [];
  for (const list of groups.values()) {
    const amounts = list.map((t) => Number(t.amount));
    const ars = list.map((t) => Number(t.area));
    const area = round1(ars.reduce((s, v) => s + v, 0) / ars.length);
    const price = Math.round(median(amounts));
    areas.push({
      area,
      areaMin: round1(Math.min(...ars)),
      areaMax: round1(Math.max(...ars)),
      pyeong: round1(area / PYEONG),
      price,
      low: Math.round(quantile(amounts, 0.25)),
      high: Math.round(quantile(amounts, 0.75)),
      deals: list.length,
      lastDeal: list.map((t) => t.deal_date).sort().slice(-1)[0],
      pricePerPyeong: Math.round(price / (area / PYEONG)),
    });
  }
  areas.sort((a, b) => b.deals - a.deals);

  // 단지 정보와 구 분포는 지역 단위 캐시를 타므로 페이지마다 새로 계산되지 않는다
  const [kapt, turn, jeonse, longTerm] = await Promise.all([
    findKapt(lawdCd, head.umd_nm ?? '', head.jibun, head.apt_nm, head.build_year).catch(() => null),
    regionTurnover(lawdCd).catch(() => null),
    regionJeonseRatios(lawdCd).catch(() => null),
    loadRegionIndex(lawdCd).catch(() => []),
  ]);

  let facts: ComplexFacts | null = null;
  if (kapt) {
    const entry = turn?.byKapt.get(kapt.kaptCode) ?? null;
    const rentNames = entry ? [...new Set(entry.blocks.map((b) => b.aptNm))] : [head.apt_nm];
    const rentCount = await db
      .from('apt_rent')
      .select('*', { count: 'exact', head: true })
      .eq('lawd_cd', lawdCd)
      .eq('umd_nm', head.umd_nm ?? '')
      .in('apt_nm', rentNames)
      .gte('deal_ym', from12);
    facts = buildComplexFacts({
      kapt,
      saleCount12m: entry?.sales ?? recent12.length,
      rentCount12m: rentCount.count ?? 0,
    });
  }

  return {
    lawdCd,
    regionName: region.name,
    regionLabel: `${region.sido} ${region.name}`,
    aptSeq,
    aptNm: head.apt_nm,
    umdNm: head.umd_nm ?? '',
    jibun: head.jibun,
    buildYear: head.build_year == null ? null : Number(head.build_year),
    areas,
    recent: trades.slice(0, 40).map((t) => ({
      dealDate: t.deal_date,
      area: Number(t.area),
      floor: t.floor == null ? null : Number(t.floor),
      amount: Number(t.amount),
      dealingGbn: t.dealing_gbn,
    })),
    deals12m: recent12.length,
    facts,
    turnoverLabel: turnoverLabel(facts?.turnoverPct ?? null),
    turnover: turn
      ? position(facts?.turnoverPct ?? null, turn.distribution, valuesOf(turn.byComplex))
      : null,
    jeonseRatio: jeonse
      ? position(jeonse.byComplex.get(aptSeq) ?? null, jeonse.distribution, valuesOf(jeonse.byComplex))
      : null,
    longTerm,
  };
}

/**
 * 정적 페이지를 만들 단지 목록.
 *
 * 최근 1년 거래가 있는 단지만 만든다 — 거래가 없으면 보여줄 것이 없고,
 * 내용 없는 페이지를 대량으로 내면 검색엔진이 사이트 전체를 낮게 본다.
 */
export async function tradedComplexes(
  opts: { minDeals?: number } = {},
): Promise<{ aptSeq: string; deals: number }[]> {
  const minDeals = opts.minDeals ?? 1;
  const from12 = recentMonths(12)[0];
  const rows = await fetchAllPaged<{ apt_seq: string }>(
    () =>
      serverClient()
        .from('apt_trade')
        .select('apt_seq')
        .eq('canceled', false)
        .gte('deal_ym', from12),
    { label: '단지 목록 조회', hardLimit: 600_000 },
  );
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.apt_seq, (count.get(r.apt_seq) ?? 0) + 1);
  return [...count.entries()]
    .filter(([, n]) => n >= minDeals)
    .map(([aptSeq, deals]) => ({ aptSeq, deals }))
    .sort((a, b) => b.deals - a.deals);
}

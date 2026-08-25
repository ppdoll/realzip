import { PYEONG, median, quantile } from './stats';
import type { Trade } from './types';
import { fetchAllPaged, serverClient } from './supabase';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  지역 장기 가격지수 — 원본을 버리고 요약만 남긴다
 * ────────────────────────────────────────────────────────────────────────
 *
 *  10년치 원본을 담으면 매매만 약 2,280,000행 850MB 로 무료 티어의 두 배다.
 *  그런데 예상 시세는 최근성 반감기가 12개월이라 7년 전 거래는 가중치가
 *  2^-84 ≈ 0 이다 — 용량을 두 배로 써도 추정값은 그대로다.
 *
 *  10년이 실제로 쓸모 있는 곳은 **장기 흐름 차트** 하나뿐이고, 그건 월별 요약이면
 *  충분하다. 그래서 국토부에서 그 달을 받아 **집계만 남기고 원본은 버린다.**
 *  76개 지역 × 120개월 = 9,120행, 원본의 0.4% 다.
 *
 *  값은 **전용 평단가의 중위값**이다. 평균이 아닌 이유는 한 달에 초고가 한 건이
 *  섞여도 흔들리지 않아야 해서다. 다만 중위 평단가는 **어느 동네가 거래됐는지에
 *  흔들린다** — 그 달에 비싼 동에서 거래가 몰리면 실제 시세가 그대로여도 올라간다.
 *  그래서 이 값은 "그 달 실제로 거래된 평단가" 로만 읽어야 하고, 단지 하나의 시세
 *  변화를 이걸로 판단하면 안 된다. 상세 화면의 지역 지수(2원 고정효과)는 그
 *  흔들림을 걷어낸 값이라 목적이 다르다.
 */

export type RegionIndexRow = {
  lawdCd: string;
  dealYm: string;
  /** 전용 평당 만원 중위 */
  pppMedian: number;
  pppP25: number | null;
  pppP75: number | null;
  deals: number;
};

/** 거래 목록에서 월별 요약을 만든다 — 저장할 것은 이것뿐이다 */
export function summarizeMonths(lawdCd: string, trades: Trade[]): RegionIndexRow[] {
  const byYm = new Map<string, number[]>();
  for (const t of trades) {
    if (t.canceled) continue;
    if (!(t.area > 0) || !(t.amount > 0)) continue;
    const ppp = t.amount / (t.area / PYEONG);
    const ym = t.dealDate.slice(0, 4) + t.dealDate.slice(5, 7);
    const g = byYm.get(ym);
    if (g) g.push(ppp);
    else byYm.set(ym, [ppp]);
  }

  const out: RegionIndexRow[] = [];
  for (const [dealYm, values] of byYm) {
    // 한 달에 몇 건뿐이면 중위값이 흔들린다 — 차트에 점을 찍지 않는다
    if (values.length < 5) continue;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    out.push({
      lawdCd,
      dealYm,
      pppMedian: round2(median(values)),
      pppP25: round2(quantile(values, 0.25)),
      pppP75: round2(quantile(values, 0.75)),
      deals: values.length,
    });
  }
  return out.sort((a, b) => (a.dealYm < b.dealYm ? -1 : 1));
}

export async function saveRegionIndex(rows: RegionIndexRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = serverClient();
  const payload = rows.map((r) => ({
    lawd_cd: r.lawdCd,
    deal_ym: r.dealYm,
    ppp_median: r.pppMedian,
    ppp_p25: r.pppP25,
    ppp_p75: r.pppP75,
    deals: r.deals,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await db
      .from('region_index')
      .upsert(payload.slice(i, i + 500), { onConflict: 'lawd_cd,deal_ym' });
    if (error) throw new Error(`region_index 적재 실패: ${error.message}`);
  }
  return payload.length;
}

/** 이 지역에 이미 있는 달 — 다시 받지 않으려고 본다 */
export async function indexedMonths(lawdCd: string): Promise<Set<string>> {
  const rows = await fetchAllPaged<{ deal_ym: string }>(
    () => serverClient().from('region_index').select('deal_ym').eq('lawd_cd', lawdCd),
    { label: 'region_index 조회', hardLimit: 5_000 },
  );
  return new Set(rows.map((r) => r.deal_ym));
}

export async function loadRegionIndex(lawdCd: string): Promise<RegionIndexRow[]> {
  const rows = await fetchAllPaged<{
    deal_ym: string;
    ppp_median: number;
    ppp_p25: number | null;
    ppp_p75: number | null;
    deals: number;
  }>(
    () =>
      serverClient()
        .from('region_index')
        .select('deal_ym, ppp_median, ppp_p25, ppp_p75, deals')
        .eq('lawd_cd', lawdCd)
        .order('deal_ym', { ascending: true }),
    { label: 'region_index 조회', hardLimit: 5_000 },
  );
  return rows.map((r) => ({
    lawdCd,
    dealYm: r.deal_ym,
    pppMedian: Number(r.ppp_median),
    pppP25: r.ppp_p25 == null ? null : Number(r.ppp_p25),
    pppP75: r.ppp_p75 == null ? null : Number(r.ppp_p75),
    deals: Number(r.deals),
  }));
}

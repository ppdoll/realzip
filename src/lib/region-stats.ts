import { REGIONS } from '@/data/regions';
import { buildRegionIndex } from './estimate';
import { WINDOW_MONTHS } from './config';
import { PYEONG, trimmedMedian } from './stats';
import { recentMonths, toYm } from './months';
import { fetchAllPaged, serverClient } from './supabase';
import type { Trade } from './types';

/**
 * 시/도 단위 지역 통계 — 추천 목록에 "그 동네가 어떤 곳인지"를 붙이기 위한 것.
 *
 * **필요한 지역만** 계산한다. 처음엔 서울 25개 구를 한 번에 계산했는데 36개월치
 * 198,000행을 읽느라 18초가 걸렸다. 추천 결과는 보통 4~8개 구에 걸치므로 그만큼만
 * 읽으면 5만 행 안쪽이다. 지역별로 따로 캐시해서 다음 요청은 그냥 맞는다.
 *
 * **수준(평단가)은 중위값, 변동률은 가격지수**로 낸다. 처음엔 변동률도 중위값 비교로
 * 냈는데 서초구가 -10.6% 로 나왔다 — 강남 +8.7%, 성동 +11.1% 인 상승장에서 말이 안 되는
 * 값이었다. 서초는 반포·방배·양재의 가격대 차이가 커서 **어느 동이 거래됐는지에 따라
 * 중위값이 통째로 흔들린다.** 그래서 변동률은 상세 화면과 같은 2원 고정효과 지수
 * (`buildRegionIndex`)로 계산한다. 수준은 구성 변화에 흔들려도 "동네 감"에는 충분해서
 * 중위값을 그대로 쓴다.
 *
 * 지수 창은 상세 화면과 **같은 36개월**을 쓴다. 처음엔 쿼리를 줄이려고 24개월로 했는데
 * 강남구가 여기선 +3%, 상세 화면에선 +8.7% 로 갈렸다 — 창이 짧으면 같은 평형이 2번
 * 이상 거래된 unit 이 적어져 월 효과가 0 쪽으로 눌린다. 같은 값이 화면마다 다르게
 * 보이는 건 결함이라 창을 맞췄다.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;

export type RegionStat = {
  lawdCd: string;
  label: string;
  /** 최근 12개월 중위 전용 평단가 (만원/평) */
  medianPricePerPyeong: number | null;
  /** 최근 12개월 거래 건수 */
  dealCount12m: number;
  /** 가격지수 기준 최근 1년 변동 (%) — 상세 화면의 '지역 시세 (1년)' 과 같은 값 */
  yoyPct: number | null;
};

type Row = {
  lawd_cd: string;
  apt_seq: string;
  deal_ym: string;
  area: number;
  amount: number;
  canceled: boolean;
};

/** 지역별 캐시 — 요청마다 필요한 지역만 계산한다 */
const cache = new Map<string, { at: number; stat: RegionStat }>();

/** 서울 25개 구 코드 */
export const SEOUL_CODES = REGIONS.filter((r) => r.code.startsWith('11')).map((r) => r.code);

const label = (code: string) => {
  const r = REGIONS.find((x) => x.code === code);
  return r ? `${r.sido} ${r.name}` : code;
};

/**
 * 주어진 시군구들의 통계. 지역별로 30분 캐시한다.
 *
 * 수준(평단가)은 최근 12개월 중위값, 변동률은 36개월 창의 가격지수 —
 * 상세 화면의 "지역 시세 (1년)" 과 같은 방식·같은 창이라 두 화면 값이 일치한다.
 */
export async function regionStatsFor(codes: string[]): Promise<Map<string, RegionStat>> {
  const out = new Map<string, RegionStat>();
  const missing: string[] = [];

  for (const code of codes) {
    const hit = cache.get(code);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) out.set(code, hit.stat);
    else missing.push(code);
  }
  if (missing.length === 0) return out;

  const now = new Date();
  // 수준은 최근 12개월, 지수는 상세 화면과 같은 36개월 창
  const recentFrom = recentMonths(12, now)[0];
  const indexFrom = recentMonths(WINDOW_MONTHS, now)[0];
  const to = toYm(now);

  const rows = await fetchAllPaged<Row>(
    () =>
      serverClient()
        .from('apt_trade')
        // apt_seq 는 가격지수(같은 단지·평형 비교)에, canceled 는 해제 거래 제외에 필요하다
        .select('lawd_cd, apt_seq, deal_ym, area, amount, canceled')
        .in('lawd_cd', missing)
        .gte('deal_ym', indexFrom)
        .lte('deal_ym', to),
    { label: '지역 통계 조회' },
  );

  const recentPpp = new Map<string, number[]>();
  const byRegion = new Map<string, Trade[]>();

  for (const r of rows) {
    const area = Number(r.area);
    const amount = Number(r.amount);
    if (!(area > 0) || !(amount > 0)) continue;
    // 해제 거래는 상세 화면과 마찬가지로 제외한다 — 포함하면 값이 어긋난다
    if (r.canceled) continue;

    if (r.deal_ym >= recentFrom) {
      const ppp = (amount / area) * PYEONG;
      const arr = recentPpp.get(r.lawd_cd);
      if (arr) arr.push(ppp);
      else recentPpp.set(r.lawd_cd, [ppp]);
    }

    // buildRegionIndex 는 aptSeq·area·dealYm·amount·canceled 만 본다
    const t = {
      aptSeq: r.apt_seq,
      lawdCd: r.lawd_cd,
      umdNm: '',
      aptNm: '',
      jibun: null,
      roadNm: null,
      buildYear: null,
      area,
      floor: null,
      dealDate: `${r.deal_ym.slice(0, 4)}-${r.deal_ym.slice(4, 6)}-15`,
      dealYm: r.deal_ym,
      amount,
      dealingGbn: null,
      buyerGbn: null,
      slerGbn: null,
      canceled: false,
      rgstDate: null,
    } satisfies Trade;
    const g = byRegion.get(r.lawd_cd);
    if (g) g.push(t);
    else byRegion.set(r.lawd_cd, [t]);
  }

  for (const code of missing) {
    const rec = recentPpp.get(code) ?? [];
    const recMed = rec.length >= 10 ? trimmedMedian(rec, 0.1) : null;

    let yoyPct: number | null = null;
    const trades = byRegion.get(code);
    if (trades && trades.length >= 60) {
      const index = buildRegionIndex(trades, indexFrom, to);
      const last = index[index.length - 1]?.index;
      const twelveAgo = index[index.length - 13]?.index;
      if (last && twelveAgo && twelveAgo > 0) {
        yoyPct = Math.round((last / twelveAgo - 1) * 1000) / 10;
      }
    }

    const stat: RegionStat = {
      lawdCd: code,
      label: label(code),
      medianPricePerPyeong: recMed == null ? null : Math.round(recMed * 10) / 10,
      dealCount12m: rec.length,
      yoyPct,
    };
    cache.set(code, { at: Date.now(), stat });
    out.set(code, stat);
  }

  return out;
}

/** 지역이 새로 적재됐을 때 캐시를 버린다 */
export function resetRegionStatsCache(): void {
  cache.clear();
}

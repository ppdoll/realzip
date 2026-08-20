'use client';

import type { RegionStat } from '@/lib/region-stats';
import type { SimilarComplex } from '@/lib/similar';
import { krwShort, pct, pyeong, shortDate } from '@/lib/format';

export type SimilarResponse = {
  base: { lawdCd: string; label: string; aptSeq: string; area: number; price: number };
  window: { from: string; months: number };
  tolerance: { areaPct: number; pricePct: number };
  candidateTrades: number;
  items: SimilarComplex[];
  regions: Record<string, RegionStat>;
};

type Props = {
  data: SimilarResponse | null;
  loading: boolean;
  error: string | null;
  onSelect: (lawdCd: string, aptSeq: string, area: number) => void;
};

export default function SimilarCard({ data, loading, error, onSelect }: Props) {
  if (loading) {
    return (
      <div className="card">
        <h2 className="card-title">이 가격대의 다른 서울 아파트</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          <span className="spinner" /> 서울 25개 구에서 비슷한 값을 찾는 중…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="card-title">이 가격대의 다른 서울 아파트</h2>
        <div className="callout error">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  // 지역별로 묶어서 보여준다 — 지역 정보를 머리에 한 번만 쓰면 되고,
  // "이 돈이면 어느 동네" 라는 판단에도 그 편이 맞다.
  const byRegion = new Map<string, SimilarComplex[]>();
  for (const it of data.items) {
    const g = byRegion.get(it.lawdCd);
    if (g) g.push(it);
    else byRegion.set(it.lawdCd, [it]);
  }

  return (
    <div className="card">
      <h2 className="card-title">
        이 가격대의 다른 서울 아파트 · {krwShort(data.base.price)} 기준
      </h2>
      <p className="card-sub">
        전용 {data.base.area}㎡({pyeong(data.base.area)}평) · {krwShort(data.base.price)} 과
        비슷한 서울 단지입니다. 면적 ±{data.tolerance.areaPct}% · 금액 ±
        {data.tolerance.pricePct}% 안에서 최근 12개월 실거래를 찾아
        <b> 단지·평형별 중위 거래금액</b>으로 줄 세웠습니다 (상세 화면의 회귀 추정과 달리
        서로 같은 기준으로 비교하기 위한 값입니다).
      </p>

      {data.items.length === 0 ? (
        <div className="callout">
          이 조건에 맞는 서울 단지를 찾지 못했습니다. 가격대가 서울 시장에서 드문 구간일 수
          있습니다 (최근 12개월 후보 거래 {data.candidateTrades}건).
        </div>
      ) : (
        <>
          {[...byRegion.entries()].map(([code, list]) => {
            const r = data.regions[code];
            return (
              <section key={code} className="sim-region">
                <header className="sim-region-head">
                  <span className="nm">{r?.label ?? code}</span>
                  {r && (
                    <span className="stats">
                      구 중위 평단{' '}
                      <b>
                        {r.medianPricePerPyeong != null
                          ? `${Math.round(r.medianPricePerPyeong).toLocaleString('ko-KR')}만`
                          : '—'}
                      </b>
                      {' · '}1년{' '}
                      <b className={r.yoyPct == null ? '' : r.yoyPct > 0 ? 'delta-up' : 'delta-down'}>
                        {pct(r.yoyPct)}
                      </b>
                      {' · '}12개월 거래 {r.dealCount12m.toLocaleString('ko-KR')}건
                    </span>
                  )}
                </header>

                <ul className="sim-list">
                  {list.map((it) => (
                    <li key={`${it.aptSeq}|${it.area}`}>
                      <button
                        className="sim-item"
                        onClick={() => onSelect(it.lawdCd, it.aptSeq, it.area)}
                        aria-label={`${it.aptNm}, ${it.umdNm}, 전용 ${it.area}제곱미터, ${krwShort(
                          it.price,
                        )}, 기준 대비 ${pct(it.diffPct)}. 눌러서 상세 보기`}
                      >
                        <span className="c1">
                          <span className="nm">{it.aptNm}</span>
                          <span className="sub">
                            {it.umdNm}
                            {it.buildYear ? ` · ${it.buildYear}년` : ''}
                          </span>
                        </span>
                        <span className="c2 tabular">
                          {it.area}㎡
                          <span className="sub">{pyeong(it.area)}평</span>
                        </span>
                        <span className="c3 tabular">
                          <b>{krwShort(it.price)}</b>
                          <span className="sub">
                            평단 {Math.round(it.pricePerPyeong).toLocaleString('ko-KR')}만
                          </span>
                        </span>
                        <span className="c4 tabular">
                          {pct(it.diffPct)}
                          <span className="sub">
                            {it.dealCount}건 · {shortDate(it.lastDealDate)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <ul className="notes">
            <li>
              여기 금액은 <b>최근 12개월 중위 실거래가</b>이고, 위쪽 예상 실거래가(면적·층
              보정 회귀)와는 계산 방식이 다릅니다. 단지끼리 같은 기준으로 비교하려고
              단순화했습니다.
            </li>
            <li>
              구 <b>1년 변동</b>은 상세 화면의 &quot;지역 시세 (1년)&quot; 과 같은 가격지수를
              씁니다 — 어느 동네가 거래됐는지에 흔들리지 않는 값입니다. 중위 평단가는
              구성 변화가 반영된 실측값이라 동네 수준을 보는 용도입니다.
            </li>
            <li className="muted">
              같은 값이라도 학군·교통·재건축 단계는 전혀 반영되지 않았습니다. 후보를 좁히는
              데만 쓰세요.
            </li>
          </ul>
        </>
      )}
    </div>
  );
}

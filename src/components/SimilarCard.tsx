'use client';

import { useMemo, useState } from 'react';
import type { RegionStat } from '@/lib/region-stats';
import type { SimilarComplex } from '@/lib/similar';
import { krwShort, pct, pyeong, shortDate } from '@/lib/format';

/** 추천 단지 + 그 단지의 구 단위 지표 (없을 수 있다) */
export type SimilarItem = SimilarComplex & {
  /** 최근 1년 매매 ÷ 세대수 (%) — K-apt 에 없는 단지는 null */
  turnoverPct: number | null;
  /** 같은 평형 중위 전세 ÷ 중위 매매 (%) — 전세 신고가 적으면 null */
  jeonseRatioPct: number | null;
};

export type SimilarResponse = {
  base: { lawdCd: string; label: string; aptSeq: string; area: number; price: number };
  window: { from: string; months: number };
  tolerance: { areaPct: number; pricePct: number };
  candidateTrades: number;
  items: SimilarItem[];
  regions: Record<string, RegionStat>;
};

type Props = {
  data: SimilarResponse | null;
  loading: boolean;
  error: string | null;
  onSelect: (lawdCd: string, aptSeq: string, area: number) => void;
};

/**
 * 필터 기준 — 임계값을 **현재 목록에서 뽑는다.**
 *
 * 처음에는 "4% 이상" 처럼 고정값으로 만들었는데, 가격대가 분포를 결정해서 쓸모가 없었다.
 * 실측: 35억대 서울에서 회전율 4% 이상은 12곳 중 0곳(비싼 단지는 원래 손바뀜이 느리다),
 * 9.5억대에서는 11곳 중 11곳 전부였다. 어느 쪽이든 목록이 갈리지 않는다.
 *
 * 그래서 이 목록의 중위·상위25% 를 잘라 쓰고, **실제 자른 값을 라벨에 적는다** —
 * "높은 쪽 절반" 만 적으면 무슨 기준인지 알 수 없고, "4% 이상" 만 적으면 왜 0곳인지 모른다.
 */
type Cut = { key: string; label: string; test: ((v: number) => boolean) | null };

const fmt1 = (v: number) => v.toFixed(1);

function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** 이 목록의 분포에서 자른 선택지들 */
function buildCuts(values: number[], name: string): Cut[] {
  const all: Cut = { key: 'all', label: '전체', test: null };
  // 값이 너무 적으면 나눠도 의미가 없다 — 그냥 전체만 둔다
  if (values.length < 4) return [all];
  const sorted = [...values].sort((a, b) => a - b);
  const mid = quantileOf(sorted, 0.5);
  const top = quantileOf(sorted, 0.75);
  const cuts: Cut[] = [
    all,
    { key: 'low', label: `${name} 낮은 쪽 (${fmt1(mid)}% 미만)`, test: (v) => v < mid },
    { key: 'high', label: `${name} 높은 쪽 (${fmt1(mid)}% 이상)`, test: (v) => v >= mid },
  ];
  // 중위와 상위25% 가 같은 값이면 선택지를 하나 더 둘 이유가 없다
  if (top > mid) {
    cuts.push({ key: 'top', label: `상위 1/4 (${fmt1(top)}% 이상)`, test: (v) => v >= top });
  }
  return cuts;
}

export default function SimilarCard({ data, loading, error, onSelect }: Props) {
  const [turnoverKey, setTurnoverKey] = useState('all');
  const [jeonseKey, setJeonseKey] = useState('all');

  const turnoverCuts = useMemo(
    () =>
      buildCuts(
        (data?.items ?? []).map((i) => i.turnoverPct).filter((v): v is number => v != null),
        '회전율',
      ),
    [data],
  );
  const jeonseCuts = useMemo(
    () =>
      buildCuts(
        (data?.items ?? []).map((i) => i.jeonseRatioPct).filter((v): v is number => v != null),
        '전세가율',
      ),
    [data],
  );

  // 목록이 바뀌면 사라진 선택지를 잡고 있을 수 있다 — 없는 키는 전체로 되돌린다
  const tf = turnoverCuts.find((f) => f.key === turnoverKey)?.test ?? null;
  const jf = jeonseCuts.find((f) => f.key === jeonseKey)?.test ?? null;

  const { shown, hiddenByFilter, hiddenByMissing } = useMemo(() => {
    const items = data?.items ?? [];
    if (!tf && !jf) return { shown: items, hiddenByFilter: 0, hiddenByMissing: 0 };
    let missing = 0;
    let filtered = 0;
    const keep = items.filter((it) => {
      // 지표를 모르는 단지는 조건을 걸었을 때 통과시키지 않는다.
      // 통과시키면 "조건을 만족한다"고 잘못 읽히고, 조용히 빼면 목록이 줄어든 이유를 알 수 없다.
      // 그래서 제외하되 몇 곳이 그렇게 빠졌는지 아래에 적는다.
      if (tf && it.turnoverPct == null) { missing++; return false; }
      if (jf && it.jeonseRatioPct == null) { missing++; return false; }
      const ok =
        (!tf || tf(it.turnoverPct as number)) && (!jf || jf(it.jeonseRatioPct as number));
      if (!ok) filtered++;
      return ok;
    });
    return { shown: keep, hiddenByFilter: filtered, hiddenByMissing: missing };
  }, [data, tf, jf]);

  /**
   * 각 선택지가 몇 곳을 남기는지 미리 센다.
   *
   * 35억대 서울에는 회전율 4% 이상인 단지가 아예 없다 — 비싼 단지는 원래 손바뀜이 느리다.
   * 개수를 안 보여주면 빈 목록을 만난 뒤에야 알게 되니, 고르기 전에 붙여 준다.
   * 개수는 **다른 쪽 조건을 적용한 뒤** 기준이라 좁혀 갈 때도 숫자가 맞는다.
   */
  const counts = useMemo(() => {
    const items = data?.items ?? [];
    const count = (
      list: Cut[],
      pick: (it: SimilarItem) => number | null,
      other: (it: SimilarItem) => boolean,
    ) =>
      new Map(
        list.map((f) => [
          f.key,
          items.filter((it) => {
            if (!other(it)) return false;
            if (!f.test) return true;
            const v = pick(it);
            return v != null && f.test(v);
          }).length,
        ]),
      );

    const jfOk = (it: SimilarItem) =>
      !jf || (it.jeonseRatioPct != null && jf(it.jeonseRatioPct));
    const tfOk = (it: SimilarItem) => !tf || (it.turnoverPct != null && tf(it.turnoverPct));

    return {
      turnover: count(turnoverCuts, (it) => it.turnoverPct, jfOk),
      jeonse: count(jeonseCuts, (it) => it.jeonseRatioPct, tfOk),
    };
  }, [data, tf, jf, turnoverCuts, jeonseCuts]);

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

  const filtering = Boolean(tf || jf);

  // 지역별로 묶어서 보여준다 — 지역 정보를 머리에 한 번만 쓰면 되고,
  // "이 돈이면 어느 동네" 라는 판단에도 그 편이 맞다.
  const byRegion = new Map<string, SimilarItem[]>();
  for (const it of shown) {
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
          {(turnoverCuts.length > 1 || jeonseCuts.length > 1) && (
          <div className="simfilter">
            {turnoverCuts.length > 1 && (
            <label>
              <span>회전율</span>
              <select value={turnoverKey} onChange={(e) => setTurnoverKey(e.target.value)}>
                {turnoverCuts.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} · {counts.turnover.get(f.key) ?? 0}곳
                  </option>
                ))}
              </select>
            </label>
            )}
            {jeonseCuts.length > 1 && (
            <label>
              <span>전세가율</span>
              <select value={jeonseKey} onChange={(e) => setJeonseKey(e.target.value)}>
                {jeonseCuts.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} · {counts.jeonse.get(f.key) ?? 0}곳
                  </option>
                ))}
              </select>
            </label>
            )}
            {filtering && (
              <span className="simfilter-count">
                {data.items.length}곳 중 <b>{shown.length}곳</b>
                {hiddenByFilter > 0 ? ` · 조건 밖 ${hiddenByFilter}곳` : ''}
                {hiddenByMissing > 0 ? ` · 지표 미상 ${hiddenByMissing}곳 제외` : ''}
              </span>
            )}
          </div>
          )}

          {shown.length === 0 ? (
            <div className="callout">
              걸어둔 조건을 만족하는 단지가 없습니다. 이 가격대에서는 조건이 너무 좁습니다 —
              기준을 낮추거나 &quot;전체&quot;로 돌려보세요.
            </div>
          ) : (
            [...byRegion.entries()].map(([code, list]) => {
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
                        <b
                          className={
                            r.yoyPct == null ? '' : r.yoyPct > 0 ? 'delta-up' : 'delta-down'
                          }
                        >
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
                          )}, 기준 대비 ${pct(it.diffPct)}${
                            it.turnoverPct != null ? `, 회전율 ${it.turnoverPct}퍼센트` : ''
                          }${
                            it.jeonseRatioPct != null
                              ? `, 전세가율 ${it.jeonseRatioPct}퍼센트`
                              : ''
                          }. 눌러서 상세 보기`}
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
                          <span className="c5 tabular">
                            {/* 소수 한 자리로 고정 — 42% 와 40.4% 가 섞이면 열이 어긋난다 */}
                            {it.turnoverPct != null
                              ? `회전 ${it.turnoverPct.toFixed(1)}%`
                              : '회전 —'}
                            <span className="sub">
                              {it.jeonseRatioPct != null
                                ? `전세 ${it.jeonseRatioPct.toFixed(1)}%`
                                : '전세 —'}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          <ul className="notes">
            <li>
              여기 금액은 <b>최근 12개월 중위 실거래가</b>이고, 위쪽 예상 실거래가(면적·층
              보정 회귀)와는 계산 방식이 다릅니다. 단지끼리 같은 기준으로 비교하려고
              단순화했습니다.
            </li>
            <li>
              <b>회전</b>은 최근 1년 매매 ÷ 세대수, <b>전세</b>는 같은 평형의 중위 전세 ÷ 중위
              매매입니다. 값이 같아도 <b>왜 그 값인지가 다릅니다</b> — 회전이 낮으면 매물이
              잠긴 곳(재건축 대기 등), 전세가율이 높으면 실수요 대비 매매가가 눌린 곳입니다.
              어느 쪽이 좋다는 뜻은 아닙니다.
            </li>
            <li>
              <b>—</b> 로 표시된 곳은 값이 없는 것입니다. 회전율은 K-apt(의무관리대상,
              300세대 이상 등)에 등록된 단지만, 전세가율은 같은 평형 전세 신고가 2건 이상인
              단지만 계산됩니다. 조건을 걸면 이런 단지는 제외됩니다.
            </li>
            <li>
              위 조건의 기준선(&quot;3.4% 이상&quot; 같은 값)은 <b>이 목록 안에서</b> 잘랐습니다.
              고정값으로 하면 가격대에 따라 쓸모가 없어집니다 — 35억대 서울에는 회전율 4%
              넘는 단지가 아예 없고, 9.5억대에서는 거의 전부가 넘습니다. 그래서 이 목록의
              중간값·상위 1/4 로 자르고 그 값을 그대로 적어 둡니다.
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

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Region } from '@/data/regions';
import type { Complex, Estimate, IndexPoint, Trade } from '@/lib/types';
import { krwShort, pyeong } from '@/lib/format';
import EstimateCard from './EstimateCard';
import IndexChart from './IndexChart';
import ListingCompare from './ListingCompare';
import PriceChart from './PriceChart';
import TradeTable from './TradeTable';

type SearchResponse = {
  region: { code: string; label: string };
  window: { from: string; to: string; months: number };
  totalTrades: number;
  index: IndexPoint[];
  complexes: Complex[];
  truncated: boolean;
  meta: { mode: string; fetchedMonths: number; errors: { ym: string; message: string }[] };
};

type ComplexResponse = {
  region: { code: string; label: string };
  complex: {
    aptSeq: string;
    aptNm: string;
    umdNm: string;
    jibun: string | null;
    roadNm: string | null;
    buildYear: number | null;
  };
  areas: { area: number; count: number; label: string }[];
  selectedArea: number;
  estimate: Estimate | null;
  index: IndexPoint[];
  trades: Trade[];
  meta: { mode: string; fetchedMonths: number };
};

export default function AppShell({ sidoList }: { sidoList: { sido: string; regions: Region[] }[] }) {
  const [sido, setSido] = useState(sidoList[0]?.sido ?? '');
  const [lawdCd, setLawdCd] = useState(sidoList[0]?.regions[0]?.code ?? '');
  const [query, setQuery] = useState('');

  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [area, setArea] = useState<number | null>(null);
  const [floor, setFloor] = useState<string>('');
  const [detail, setDetail] = useState<ComplexResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** 사용자가 입력한 매물 호가 — 차트에 가로 기준선으로 깐다 */
  const [askPrices, setAskPrices] = useState<number[]>([]);

  const regions = useMemo(
    () => sidoList.find((s) => s.sido === sido)?.regions ?? [],
    [sidoList, sido],
  );

  // 최초 수집은 36개월치를 받아오므로 경과 시간을 보여준다.
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (searching) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [searching]);

  async function runSearch() {
    setSearching(true);
    setError(null);
    setSelected(null);
    setDetail(null);
    setArea(null);
    setAskPrices([]);
    try {
      const url = `/api/search?lawdCd=${lawdCd}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '조회에 실패했습니다.');
      setSearch(json as SearchResponse);
    } catch (e) {
      setSearch(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function loadComplex(aptSeq: string, targetArea?: number | null, targetFloor?: string) {
    setSelected(aptSeq);
    setDetailLoading(true);
    setError(null);
    // 단지/평형이 바뀌면 이전 호가 비교는 더 이상 유효하지 않다
    setAskPrices([]);
    try {
      const params = new URLSearchParams({ lawdCd, aptSeq });
      if (targetArea) params.set('area', String(targetArea));
      if (targetFloor) params.set('floor', targetFloor);
      const res = await fetch(`/api/complex?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '단지 조회에 실패했습니다.');
      const d = json as ComplexResponse;
      setDetail(d);
      setArea(d.selectedArea);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  // 선택한 평형의 거래만 차트에 올린다 (±1.5㎡ 이내는 같은 타입으로 본다)
  const chartTrades = useMemo(() => {
    if (!detail || area == null) return [];
    return detail.trades.filter((t) => Math.abs(t.area - area) < 1.5);
  }, [detail, area]);

  return (
    <div className="page">
      <header className="masthead">
        <h1>아파트 실거래가 · 예상 시세</h1>
        <span className="sub">국토교통부 실거래 신고 데이터 · 최근 3년</span>
      </header>

      {/* ── 필터 한 줄 ── */}
      <div className="card">
        <div className="filters">
          <div className="field">
            <label htmlFor="sido">시 / 도</label>
            <select
              id="sido"
              className="control"
              value={sido}
              onChange={(e) => {
                setSido(e.target.value);
                const first = sidoList.find((s) => s.sido === e.target.value)?.regions[0];
                if (first) setLawdCd(first.code);
              }}
            >
              {sidoList.map((s) => (
                <option key={s.sido} value={s.sido}>
                  {s.sido}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="sgg">시 / 군 / 구</label>
            <select
              id="sgg"
              className="control"
              value={lawdCd}
              onChange={(e) => setLawdCd(e.target.value)}
            >
              {regions.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor="q">단지명 · 법정동 (선택)</label>
            <input
              id="q"
              className="control"
              placeholder="예: 은마, 대치동"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
            />
          </div>

          <button className="btn" onClick={() => void runSearch()} disabled={searching}>
            {searching ? '조회 중…' : '조회'}
          </button>
        </div>

        {searching && (
          <p className="card-sub" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="spinner" /> 국토교통부에서 36개월치를 받아오고 있습니다. 처음 조회하는
            지역은 20~40초쯤 걸립니다. (경과 {elapsed}초)
          </p>
        )}

        {error && (
          <div className="callout error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>

      {/* ── 단지 목록 ── */}
      {search && (
        <div className="card">
          <h2 className="card-title">
            {search.region.label} · 단지 {search.complexes.length.toLocaleString('ko-KR')}곳
          </h2>
          <p className="card-sub">
            {search.window.from.slice(0, 4)}.{search.window.from.slice(4)} ~{' '}
            {search.window.to.slice(0, 4)}.{search.window.to.slice(4)} 거래{' '}
            {search.totalTrades.toLocaleString('ko-KR')}건
            {search.truncated ? ' · 거래 많은 순 400곳만 표시' : ''}
            {search.meta.mode === 'memory' ? ' · 메모리 캐시 모드' : ''}
          </p>

          {search.complexes.length === 0 ? (
            <div className="callout">
              조건에 맞는 단지가 없습니다. 단지명 검색어를 지우거나 다른 시군구를 골라보세요.
            </div>
          ) : (
            <div className="complex-grid">
              {search.complexes.map((c) => (
                <button
                  key={c.aptSeq}
                  className="complex-item"
                  aria-pressed={selected === c.aptSeq}
                  // span 들이 붙어 있어 읽기 이름이 "은마대치동..." 처럼 뭉치므로 따로 준다
                  aria-label={`${c.aptNm}, ${c.umdNm}, ${
                    c.buildYear ? `${c.buildYear}년 준공, ` : ''
                  }최근 3년 거래 ${c.dealCount}건, 평단가 ${Math.round(
                    c.recentPricePerPyeong,
                  ).toLocaleString('ko-KR')}만원`}
                  onClick={() => void loadComplex(c.aptSeq)}
                >
                  <span className="nm">{c.aptNm}</span>
                  <span className="meta">
                    {c.umdNm} · {c.buildYear ? `${c.buildYear}년` : '건축년도 미상'} ·{' '}
                    {c.dealCount}건
                  </span>
                  <br />
                  <span className="meta">
                    평단 {Math.round(c.recentPricePerPyeong).toLocaleString('ko-KR')}만 ·{' '}
                    {c.areas.length}개 평형
                  </span>
                </button>
              ))}
            </div>
          )}

          {search.meta.errors.length > 0 && (
            <div className="callout" style={{ marginTop: 12 }}>
              일부 월을 받아오지 못했습니다 ({search.meta.errors.length}개월).{' '}
              {search.meta.errors[0]?.message}
            </div>
          )}
        </div>
      )}

      {/* ── 단지 상세 ── */}
      {detailLoading && (
        <div className="card">
          <span className="spinner" /> 단지 시세를 계산하고 있습니다…
        </div>
      )}

      {detail && !detailLoading && (
        <>
          <div className="card">
            <h2 className="card-title">
              {detail.complex.aptNm}
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                {'  '}
                {detail.region.label} {detail.complex.umdNm}
                {detail.complex.jibun ? ` ${detail.complex.jibun}` : ''}
                {detail.complex.buildYear ? ` · ${detail.complex.buildYear}년 준공` : ''}
              </span>
            </h2>

            <div className="filters" style={{ marginTop: 10 }}>
              <div className="field">
                <label htmlFor="area">전용면적</label>
                <select
                  id="area"
                  className="control"
                  value={area ?? ''}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setArea(v);
                    void loadComplex(detail.complex.aptSeq, v, floor);
                  }}
                >
                  {detail.areas.map((a) => (
                    <option key={a.area} value={a.area}>
                      {a.area}㎡ ({pyeong(a.area)}평) · {a.count}건
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="floor">층 (선택)</label>
                <input
                  id="floor"
                  className="control"
                  style={{ width: 110 }}
                  inputMode="numeric"
                  placeholder="중층 가정"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value.replace(/[^0-9-]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void loadComplex(detail.complex.aptSeq, area, floor);
                  }}
                />
              </div>

              <button
                className="btn btn-ghost"
                onClick={() => void loadComplex(detail.complex.aptSeq, area, floor)}
              >
                다시 계산
              </button>
            </div>
          </div>

          {detail.estimate ? (
            <EstimateCard estimate={detail.estimate} />
          ) : (
            <div className="card">
              <div className="callout">
                이 평형은 거래 표본이 없어 예상 시세를 계산할 수 없습니다.
              </div>
            </div>
          )}

          <ListingCompare
            lawdCd={lawdCd}
            aptSeq={detail.complex.aptSeq}
            area={area}
            onResult={setAskPrices}
          />

          <div className="card">
            <h2 className="card-title">
              실거래 추이 · 전용 {area}㎡ ({pyeong(area ?? 0)}평)
            </h2>
            <p className="card-sub">
              점은 실제 신고된 거래, 주황선은 지역 가격지수로 환산한 이 평형의 추정 시세입니다.
              {detail.estimate ? ` 현재 예상 ${krwShort(detail.estimate.price)}.` : ''}
              {askPrices.length > 0
                ? ' 초록 기준선은 입력한 매물 호가 — 과거 어느 시점 가격 수준인지 바로 보입니다.'
                : ''}
            </p>
            {detail.estimate && chartTrades.length > 0 ? (
              <PriceChart
                trades={chartTrades}
                index={detail.index}
                estimate={detail.estimate}
                listings={askPrices}
              />
            ) : (
              <div className="callout">이 평형의 거래가 없어 추이를 그릴 수 없습니다.</div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">{detail.region.label} 시세 흐름</h2>
            <p className="card-sub">
              같은 단지·같은 평형끼리만 비교해 만든 가격지수라, 어느 동네가 거래됐는지에 따라
              중위가격이 튀는 문제를 줄였습니다.
            </p>
            <IndexChart index={detail.index} />
          </div>

          <TradeTable trades={chartTrades.length > 0 ? chartTrades : detail.trades} />

          <div className="card">
            <h2 className="card-title">이 값을 어떻게 읽어야 하나요</h2>
            <ul className="notes">
              <li>
                국토교통부 실거래 신고 자료입니다. 신고 기한이 계약일로부터 30일이라 최근 1~2개월
                데이터는 아직 덜 차 있습니다.
              </li>
              <li>
                예상가는 <b>3년치 거래를 지역 가격지수로 현재 시점으로 환산</b>한 뒤, 면적·층
                유사도와 최근성(반감기 12개월)으로 가중해 회귀한 값입니다.
              </li>
              <li>
                80% 범위는 &quot;다음 거래 1건이 이 안에 들어올 확률이 약 80%&quot;라는 뜻입니다.
                표본이 적으면 자동으로 넓어집니다.
              </li>
              <li>
                직거래·해제 거래·시세와 크게 벗어난 신고는 가중치를 낮추거나 제외했습니다. 그래도
                호가·리모델링·동/향 차이는 반영되지 않습니다.
              </li>
              <li className="muted">
                투자 판단의 근거로 삼기에는 부족합니다. 참고용 추정치로만 보세요.
              </li>
            </ul>
          </div>
        </>
      )}

      {!search && !searching && !error && (
        <div className="card">
          <p className="card-sub" style={{ marginBottom: 0 }}>
            시군구를 고르고 <b>조회</b>를 누르면 최근 3년 실거래를 받아옵니다. 지역별로 첫 조회는
            시간이 걸리지만, 한 번 받아두면 이후에는 바로 나옵니다.
          </p>
        </div>
      )}
    </div>
  );
}

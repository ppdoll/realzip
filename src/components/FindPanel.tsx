'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdFit from './AdFit';
import { AREA_BANDS, m22py, py2m2, roomsHint } from '@/lib/area-bands';
import { krwShort, shortDate } from '@/lib/format';

type FindItem = {
  lawdCd: string;
  regionLabel: string;
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  buildYear: number | null;
  area: number;
  areaMin: number;
  areaMax: number;
  pyeong: number;
  price: number;
  dealCount: number;
  minAmount: number;
  maxAmount: number;
  lastDeal: string;
};

type FindResponse = {
  window: { from: string; months: number };
  query: {
    pyMin: number;
    pyMax: number;
    priceMin: number;
    priceMax: number;
    minDeals: number;
    yearMin: number | null;
    yearMax: number | null;
  };
  total: number;
  offset: number;
  skipped: { code: string; label: string }[];
  items: FindItem[];
  error?: string;
};

type RegionList = { sido: string; regions: { code: string; name: string }[] }[];

const SORTS = [
  { key: 'ppa_asc', label: '평단가 낮은 순' },
  { key: 'price_asc', label: '금액 낮은 순' },
  { key: 'price_desc', label: '금액 높은 순' },
  { key: 'deals_desc', label: '거래 많은 순' },
  { key: 'recent', label: '최근 거래 순' },
];

const PAGE = 100;

/**
 * 연식 구간.
 *
 * 사람은 "2006년 준공" 보다 "20년쯤 된 집" 으로 생각해서 나이로 고르게 하고,
 * 서버에는 연도로 바꿔 보낸다. 기준 연도는 화면에서 계산한다.
 *
 * 구간은 실측 분포에서 잡았다 — 최근 1년 거래 단지 11,677곳 중
 * 5년 이내 5.4% · 5~10년 12.0% · 10~20년 20.8% · 20~30년 36.1% · 30년 이상 25.7%.
 * 어느 구간을 골라도 표본이 남는다.
 *
 * 준공년도는 **빠진 값이 없다**(11,677곳 중 0). 조건을 걸어도 조용히 사라지는
 * 단지가 없어서, 회전율 필터처럼 "지표 미상 제외" 를 따로 적을 필요가 없다.
 */
const AGE_BANDS = [
  { key: 'all', label: '전체', min: null as number | null, max: null as number | null },
  { key: 'a5', label: '5년 이내', min: 5, max: null },
  { key: 'a10', label: '10년 이내', min: 10, max: null },
  { key: 'a1020', label: '10~20년', min: 20, max: 10 },
  { key: 'a2030', label: '20~30년', min: 30, max: 20 },
  { key: 'a30', label: '30년 이상', min: null, max: 30 },
];

/** 억 단위 입력 → 만원 */
const eok2man = (eok: number) => Math.round(eok * 10_000);
/** 만원 → 억 (소수 1자리) */
const man2eok = (man: number) => Math.round((man / 10_000) * 10) / 10;

/**
 * 조건으로 단지 찾기 — 지역 · 평형 · 금액.
 *
 * 방 갯수로는 거를 수 없다. 국토부 실거래 자료에도 K-apt 단지정보에도 방 수가
 * 없어서, 여기서 거르는 기준은 면적이고 방 수는 면적대별 참고 표기만 붙인다
 * (자세한 이유는 area-bands.ts 주석).
 *
 * 집계는 DB 함수가 한다 — 노드로 끌어오면 넓은 조건에서 175,280행 18초다.
 */
export default function FindPanel({
  onSelect,
}: {
  onSelect: (lawdCd: string, aptSeq: string, area: number) => void;
}) {
  const [regionList, setRegionList] = useState<RegionList>([]);
  const [sido, setSido] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // 기본은 전용 60~85㎡ — 국민주택 규모이고 거래가 가장 많은 구간이다
  // 기본은 전용 60~85㎡ — 국민주택 규모이고 거래가 가장 많은 구간이다
  const [bandKey, setBandKey] = useState('b85');
  const [pyMin, setPyMin] = useState('18.1');
  const [pyMax, setPyMax] = useState('25.7');
  /**
   * 구간 단추를 누르면 그 ㎡ 범위를 그대로 들고 있는다.
   * 평으로 바꿔 저장하면 왕복 변환에서 어긋난다 — 60~85㎡ 를 18~26평으로
   * 적었다가 되돌리면 59.5~85.9㎡ 가 되어 라벨과 다른 범위를 조회하게 된다.
   * 사용자가 평을 직접 고치면 이 값은 버린다.
   */
  const [m2Range, setM2Range] = useState<[number, number] | null>([60, 85]);
  const [eokMin, setEokMin] = useState('5');
  const [eokMax, setEokMax] = useState('10');
  const [minDeals, setMinDeals] = useState('3');
  const [ageKey, setAgeKey] = useState('all');
  /** 직접 입력한 준공년도 — 구간 단추를 누르면 지운다 */
  const [yrMin, setYrMin] = useState('');
  const [yrMax, setYrMax] = useState('');
  const [sort, setSort] = useState('ppa_asc');

  const [data, setData] = useState<FindResponse | null>(null);
  const [rows, setRows] = useState<FindItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // 담아둔 지역만 고를 수 있게 받아온다
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch('/api/find/regions');
        const j = await r.json();
        if (!alive) return;
        const list: RegionList = j.sidoList ?? [];
        setRegionList(list);
        const first = list[0];
        if (first) {
          setSido(first.sido);
          setPicked(new Set(first.regions.map((x) => x.code)));
        }
      } catch {
        // 목록을 못 받아도 화면은 뜨게 둔다 — 조회할 때 오류가 다시 보인다
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const regions = useMemo(
    () => regionList.find((s) => s.sido === sido)?.regions ?? [],
    [regionList, sido],
  );

  const applyBand = (key: string) => {
    const b = AREA_BANDS.find((x) => x.key === key);
    if (!b) return;
    setBandKey(key);
    const lo = b.min;
    const hi = b.max >= 1000 ? py2m2(80) : b.max;
    setM2Range([lo, hi]);
    setPyMin(String(m22py(lo)));
    setPyMax(String(m22py(hi)));
  };

  /** 평을 직접 고치면 구간 단추와 ㎡ 고정을 모두 푼다 */
  const editPy = (which: 'min' | 'max', v: string) => {
    if (which === 'min') setPyMin(v);
    else setPyMax(v);
    setBandKey('');
    setM2Range(null);
  };

  const run = useCallback(
    async (offset: number) => {
      const codes = [...picked];
      if (codes.length === 0) {
        setError('지역을 하나 이상 골라주세요.');
        return;
      }
      // 구간 단추를 눌러 둔 상태면 그 ㎡ 범위를 그대로 쓴다
      const aMin = m2Range ? m2Range[0] : py2m2(Number(pyMin) || 0);
      const aMax = m2Range ? m2Range[1] : py2m2(Number(pyMax) || 0);
      const pMin = eok2man(Number(eokMin) || 0);
      const pMax = eok2man(Number(eokMax) || 0);
      if (!(aMin < aMax)) {
        setError('평형 범위를 확인해주세요.');
        return;
      }
      if (!(pMin < pMax)) {
        setError('금액 범위를 확인해주세요.');
        return;
      }

      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      try {
        const thisYear = new Date().getFullYear();
        const band = AGE_BANDS.find((b) => b.key === ageKey);
        // 나이 -> 연도. "10년 이내" 는 (올해-10) 년 이후 준공이라는 뜻이다.
        const yMin = yrMin ? Number(yrMin) : band?.min != null ? thisYear - band.min : null;
        const yMax = yrMax ? Number(yrMax) : band?.max != null ? thisYear - band.max : null;
        if (yMin != null && yMax != null && yMin > yMax) {
          setError('준공년도 범위를 확인해주세요.');
          setLoading(false);
          return;
        }

        const qs = new URLSearchParams({
          codes: codes.join(','),
          areaMin: String(aMin),
          areaMax: String(aMax),
          priceMin: String(pMin),
          priceMax: String(pMax),
          minDeals,
          sort,
          limit: String(PAGE),
          offset: String(offset),
          ...(yMin != null ? { yearMin: String(yMin) } : {}),
          ...(yMax != null ? { yearMax: String(yMax) } : {}),
        });
        const r = await fetch(`/api/find?${qs}`);
        const j: FindResponse = await r.json();
        if (id !== reqId.current) return; // 늦게 온 응답이 앞선 결과를 덮지 않게
        if (!r.ok || j.error) {
          setError(j.error ?? '조회에 실패했습니다.');
          if (offset === 0) {
            setData(null);
            setRows([]);
          }
          return;
        }
        setData(j);
        setRows(offset === 0 ? j.items : (prev) => [...prev, ...j.items]);
      } catch (e) {
        if (id === reqId.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [picked, pyMin, pyMax, m2Range, eokMin, eokMax, minDeals, sort, ageKey, yrMin, yrMax],
  );

  const toggle = (code: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const band = AREA_BANDS.find((b) => b.key === bandKey);
  const shown = rows.length;
  const hasMore = data != null && shown < data.total;

  return (
    <>
      <div className="card">
        <h2 className="card-title">조건으로 찾기</h2>
        <p className="card-sub">
          지역·평형·금액으로 단지를 뽑습니다. 금액은 <b>단지·평형별 최근 1년 중위
          실거래가</b>를 기준으로 걸립니다 — 싼 거래 한 건 때문에 들어오는 단지가 없도록
          개별 거래가 아니라 중위값에 조건을 겁니다.
        </p>

        {/* ── 지역 ── */}
        <div className="find-row">
          <label className="find-label" htmlFor="find-sido">
            지역
          </label>
          <div className="find-body">
            <select
              id="find-sido"
              className="control"
              style={{ maxWidth: 200 }}
              value={sido}
              onChange={(e) => {
                setSido(e.target.value);
                const rs = regionList.find((s) => s.sido === e.target.value)?.regions ?? [];
                setPicked(new Set(rs.map((x) => x.code)));
              }}
            >
              {regionList.map((s) => (
                <option key={s.sido} value={s.sido}>
                  {s.sido} ({s.regions.length}곳)
                </option>
              ))}
            </select>
            <div className="chips">
              {regions.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  className="chip"
                  aria-pressed={picked.has(r.code)}
                  onClick={() => toggle(r.code)}
                >
                  {r.name}
                </button>
              ))}
              {regions.length > 1 && (
                <>
                  <button
                    type="button"
                    className="chip chip-action"
                    onClick={() => setPicked(new Set(regions.map((x) => x.code)))}
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    className="chip chip-action"
                    onClick={() => setPicked(new Set())}
                  >
                    해제
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── 평형 ── */}
        <div className="find-row">
          <label className="find-label">평형</label>
          <div className="find-body">
            <div className="chips">
              {AREA_BANDS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className="chip"
                  aria-pressed={bandKey === b.key}
                  onClick={() => applyBand(b.key)}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="find-range">
              <input
                className="control num"
                type="number"
                min={1}
                max={200}
                value={pyMin}
                aria-label="최소 평수"
                onChange={(e) => editPy('min', e.target.value)}
              />
              <span>~</span>
              <input
                className="control num"
                type="number"
                min={1}
                max={200}
                value={pyMax}
                aria-label="최대 평수"
                onChange={(e) => editPy('max', e.target.value)}
              />
              <span className="unit">평</span>
              <span className="muted">
                전용{' '}
                {m2Range
                  ? `${m2Range[0]}~${m2Range[1]}`
                  : `${Math.round(py2m2(Number(pyMin) || 0))}~${Math.round(py2m2(Number(pyMax) || 0))}`}
                ㎡
                {band ? ` · ${band.rooms} (참고)` : ''}
              </span>
            </div>
          </div>
        </div>

        {/* ── 금액 ── */}
        <div className="find-row">
          <label className="find-label">금액</label>
          <div className="find-body">
            <div className="find-range">
              <input
                className="control num"
                type="number"
                min={0}
                step={0.5}
                value={eokMin}
                aria-label="최소 금액 (억)"
                onChange={(e) => setEokMin(e.target.value)}
              />
              <span>~</span>
              <input
                className="control num"
                type="number"
                min={0.5}
                step={0.5}
                value={eokMax}
                aria-label="최대 금액 (억)"
                onChange={(e) => setEokMax(e.target.value)}
              />
              <span className="unit">억</span>
            </div>
          </div>
        </div>

        {/* ── 준공년도 ── */}
        <div className="find-row">
          <label className="find-label">준공</label>
          <div className="find-body">
            <div className="chips">
              {AGE_BANDS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className="chip"
                  aria-pressed={ageKey === b.key && !yrMin && !yrMax}
                  onClick={() => {
                    setAgeKey(b.key);
                    setYrMin('');
                    setYrMax('');
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="find-range">
              <input
                className="control num"
                type="number"
                min={1950}
                max={2100}
                placeholder="1961"
                value={yrMin}
                aria-label="준공년도 하한"
                onChange={(e) => {
                  setYrMin(e.target.value);
                  setAgeKey('all');
                }}
              />
              <span>~</span>
              <input
                className="control num"
                type="number"
                min={1950}
                max={2100}
                placeholder={String(new Date().getFullYear())}
                value={yrMax}
                aria-label="준공년도 상한"
                onChange={(e) => {
                  setYrMax(e.target.value);
                  setAgeKey('all');
                }}
              />
              <span className="unit">년</span>
              <span className="muted">비우면 제한 없음</span>
            </div>
          </div>
        </div>

        {/* ── 그 밖 ── */}
        <div className="find-row">
          <label className="find-label">조건</label>
          <div className="find-body">
            <div className="find-range">
              <label className="inline">
                <span>최소 거래</span>
                <select
                  className="control"
                  value={minDeals}
                  onChange={(e) => setMinDeals(e.target.value)}
                >
                  <option value="1">1건 이상</option>
                  <option value="3">3건 이상</option>
                  <option value="5">5건 이상</option>
                  <option value="10">10건 이상</option>
                </select>
              </label>
              <label className="inline">
                <span>정렬</span>
                <select className="control" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn" onClick={() => void run(0)} disabled={loading}>
                {loading ? '찾는 중…' : '찾기'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="callout error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <ul className="notes" style={{ marginTop: 14 }}>
          <li>
            <b>여기 평수는 전용면적입니다.</b> 흔히 말하는 &quot;34평 아파트&quot; 는 공급면적
            기준이고 전용은 84㎡(25.4평)입니다. 실거래 신고 자료에는 전용면적만 있어서
            전용으로 셉니다 — 34평형을 찾으시면 <b>25~26평</b>, 24평형이면 <b>17~18평</b>{' '}
            으로 넣으세요. 위 구간 단추는 청약·세금이 쓰는 전용면적 기준(60·85·135㎡)입니다.
          </li>
          <li>
            <b>방 갯수로는 거를 수 없습니다.</b> 국토교통부 실거래 자료에도 공동주택
            단지정보에도 방 수가 없습니다. 그래서 조건은 <b>면적</b>으로 걸고, 위의 &quot;보통
            3룸&quot; 같은 표기는 그 면적대에 흔한 구성일 뿐 이 단지의 실제 구조가 아닙니다 —
            같은 84㎡ 에서도 3룸과 4룸이 갈립니다.
          </li>
          <li>
            <b>준공년도는 실거래 신고에 적힌 건축년도</b>입니다. 최근 1년 거래 단지
            11,677곳 중 빠진 값이 없어서, 조건을 걸어도 조용히 빠지는 단지는 없습니다.
            재건축으로 다시 지은 단지는 새 건물의 준공년도로 잡힙니다.
          </li>
          <li>
            담아둔 지역만 고를 수 있습니다. 목록에 없는 시군구는 아직 데이터를 받지 않은
            곳입니다.
          </li>
        </ul>
      </div>

      {/* 가로 배너 — 조건 검색에서도 검색창(필터) 바로 아래에 둔다 */}
      <AdFit slot="banner" />

      {data && (
        <div className="card">
          <h2 className="card-title">
            조건에 맞는 단지 {data.total.toLocaleString('ko-KR')}곳
            {data.total > shown && (
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                {'  '}
                상위 {shown.toLocaleString('ko-KR')}곳 표시
              </span>
            )}
          </h2>
          <p className="card-sub">
            {data.window.from.slice(0, 4)}.{data.window.from.slice(4)} 이후 · {data.query.pyMin}~
            {data.query.pyMax}평 · {man2eok(data.query.priceMin)}~{man2eok(data.query.priceMax)}억 ·
            최소 {data.query.minDeals}건
            {(data.query.yearMin != null || data.query.yearMax != null) &&
              ` · 준공 ${data.query.yearMin ?? ''}~${data.query.yearMax ?? ''}년`}
            . 같은 단지의 다른 평형은 따로 셉니다.
          </p>

          {rows.length === 0 ? (
            <div className="callout">
              조건에 맞는 단지가 없습니다. 금액이나 평형 범위를 넓혀보세요.
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="find-table">
                  <thead>
                    <tr>
                      <th>단지</th>
                      <th className="r">전용</th>
                      <th className="r">중위 실거래</th>
                      <th className="r">평단가</th>
                      <th className="r">거래</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((it) => (
                      <tr key={`${it.aptSeq}|${it.area}`}>
                        <td>
                          <button
                            className="link"
                            onClick={() => onSelect(it.lawdCd, it.aptSeq, it.area)}
                          >
                            {it.aptNm}
                          </button>
                          <span className="sub">
                            {it.regionLabel} {it.umdNm}
                            {it.buildYear ? ` · ${it.buildYear}년` : ''}
                          </span>
                        </td>
                        <td className="r tabular">
                          {it.pyeong}평
                          {/* 방 수는 면적에서 유추한 참고값이라 면적 옆에 둔다 */}
                          <span className="sub">
                            {/* 1.5㎡ 안의 타입은 한 줄로 묶었다 — 여러 타입이면 범위로 보인다 */}
                            {it.areaMax - it.areaMin > 0.05
                              ? `${it.areaMin}~${it.areaMax}㎡`
                              : `${it.area}㎡`}
                            {roomsHint(it.area) ? ` · ${roomsHint(it.area)}` : ''}
                          </span>
                        </td>
                        <td className="r tabular">
                          <b>{krwShort(it.price)}</b>
                          <span className="sub">
                            {krwShort(it.minAmount)}~{krwShort(it.maxAmount)}
                          </span>
                        </td>
                        <td className="r tabular">
                          {Math.round(it.price / it.pyeong).toLocaleString('ko-KR')}만
                          <span className="sub">평당</span>
                        </td>
                        <td className="r tabular">
                          {it.dealCount}건
                          <span className="sub">{shortDate(it.lastDeal)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {hasMore && (
                <button
                  className="btn btn-ghost"
                  style={{ width: '100%', marginTop: 12 }}
                  disabled={loading}
                  onClick={() => void run(shown)}
                >
                  {loading ? '불러오는 중…' : `${Math.min(PAGE, data.total - shown)}곳 더 보기`}
                </button>
              )}
            </>
          )}

          <ul className="notes">
            <li>
              <b>중위 실거래</b>는 그 단지·평형의 최근 1년 거래를 금액순으로 줄 세운 가운데
              값입니다. 옆의 작은 숫자는 최저~최고입니다 — 벌어져 있으면 층·향에 따라 값이
              크게 갈리는 평형입니다.
            </li>
            <li>
              단지명을 누르면 그 평형의 <b>예상 시세와 거래 내역</b>으로 넘어갑니다. 여기 금액은
              중위 실거래이고, 상세 화면의 예상 시세는 면적·층을 보정한 회귀 추정이라 값이
              다릅니다.
            </li>
            <li>
              같은 단지에서 <b>전용면적이 1.5㎡ 안쪽인 타입은 한 줄로 묶었습니다.</b>{' '}
              84.44㎡ 와 84.57㎡ 를 따로 세면 같은 평수 두 줄이 나란히 나와서 읽기 나쁩니다.
              묶인 줄은 면적이 <b>121.5~121.7㎡</b> 처럼 범위로 표시됩니다.
            </li>
            <li className="muted">
              거래가 적은 평형은 중위값이 흔들립니다. &quot;최소 거래&quot; 를 3건 이상으로
              두면 그런 평형이 빠집니다.
            </li>
          </ul>
        </div>
      )}
    </>
  );
}

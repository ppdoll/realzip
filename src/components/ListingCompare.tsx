'use client';

import { useState } from 'react';
import type { CompareResult, ListingComparison } from '@/lib/compare';
import { CONFIDENCE_LABEL, krw, krwShort, pct, pyeong } from '@/lib/format';

type Props = {
  lawdCd: string;
  aptSeq: string;
  /** 면적이 안 적힌 매물에 적용할 기본 전용면적 */
  area: number | null;
  /** 비교가 끝나면 호가 목록을 올려보내 차트에 기준선으로 깔게 한다 */
  onResult: (prices: number[]) => void;
};

const PLACEHOLDER = `네이버부동산 등에서 본 호가를 한 줄에 하나씩 붙여넣으세요.

18억 5,000  12층
17억 8000   3층
18.5억      중층
109.42/84.97㎡ 12/15층 19억`;

/** 구간 대비 위치 — 좋고 나쁨의 판단이 아니므로 색을 쓰지 않고 기호와 말로만 표시한다. */
const POSITION: Record<ListingComparison['position'], { glyph: string; label: string }> = {
  below: { glyph: '▼', label: '구간 아래' },
  inside: { glyph: '●', label: '구간 내' },
  above: { glyph: '▲', label: '구간 위' },
};

export default function ListingCompare({ lawdCd, aptSeq, area, onResult }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lawdCd, aptSeq, area: area ?? undefined, text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '비교에 실패했습니다.');
      const r = json as CompareResult;
      setResult(r);
      onResult(r.items.map((i) => i.price));
    } catch (e) {
      setResult(null);
      onResult([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function clear() {
    setText('');
    setResult(null);
    setError(null);
    onResult([]);
  }

  const s = result?.summary;

  return (
    <div className="card">
      <h2 className="card-title">매물 호가와 대조</h2>
      <p className="card-sub">
        개별 매물 호가를 제공하는 공개 API 는 없습니다 (공공데이터포털은 실거래가만, 네이버부동산은
        공식 API 미제공). 보고 계신 호가를 붙여넣으면 같은 모델로 그 면적·층의 추정가를 계산해
        대조합니다.
      </p>

      <label htmlFor="listings" className="sr-only">
        매물 호가 목록
      </label>
      <textarea
        id="listings"
        className="paste-area"
        placeholder={PLACEHOLDER}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <p className="paste-hint">
        금액은 <code>18억 5,000</code> · <code>18억5천</code> · <code>18.5억</code> ·{' '}
        <code>185000</code> 모두 읽습니다. 층은 <code>12층</code> · <code>12/15층</code> ·{' '}
        <code>중층</code>, 면적은 <code>84.97㎡</code> · <code>34평</code> ·{' '}
        <code>109.42/84.97㎡</code> 를 인식합니다. 면적을 안 적으면 위에서 고른 평형(
        {area != null ? `${area}㎡` : '—'})으로 계산합니다.
      </p>

      <div className="filters" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => void run()} disabled={loading || !text.trim()}>
          {loading ? '계산 중…' : '대조하기'}
        </button>
        {(result || text) && (
          <button className="btn btn-ghost" onClick={clear}>
            지우기
          </button>
        )}
      </div>

      {error && (
        <div className="callout error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {s && (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="label">읽은 매물</div>
              <div className="value tabular">{s.count}건</div>
              <div className="foot">
                구간 내 {s.insideCount} · 위 {s.aboveCount} · 아래 {s.belowCount}
              </div>
            </div>
            <div className="tile">
              <div className="label">최저 호가</div>
              <div className="value tabular">{krwShort(s.minPrice)}</div>
              <div className="foot">최고 {krwShort(s.maxPrice)}</div>
            </div>
            <div className="tile">
              <div className="label">중위 호가</div>
              <div className="value tabular">{krwShort(s.medianPrice)}</div>
              <div className="foot">{s.count}건 기준</div>
            </div>
            <div className="tile">
              <div className="label">추정가 대비</div>
              <div className="value tabular">{pct(s.medianGapPct)}</div>
              <div className="foot">중위 호가 − 추정 실거래가</div>
            </div>
          </div>

          <div className="table-scroll" style={{ marginTop: 14 }}>
            <table className="data">
              <caption className="sr-only">매물 호가와 추정 실거래가 대조 결과</caption>
              <thead>
                <tr>
                  <th scope="col">호가</th>
                  <th scope="col">층</th>
                  <th scope="col">전용</th>
                  <th scope="col">추정 실거래가</th>
                  <th scope="col">80% 구간</th>
                  <th scope="col">차이</th>
                  <th scope="col">위치</th>
                  <th scope="col">백분위</th>
                  <th scope="col">신뢰도</th>
                </tr>
              </thead>
              <tbody>
                {result!.items.map((i, k) => (
                  <tr key={k}>
                    <td>
                      <b>{krw(i.price)}</b>
                    </td>
                    <td>
                      {i.floor != null ? `${i.floor}층` : '—'}
                      {i.floorAssumed ? '*' : ''}
                    </td>
                    <td>
                      {i.area}㎡ ({pyeong(i.area)}평)
                    </td>
                    <td>{krw(i.estimated)}</td>
                    <td className="muted">
                      {krwShort(i.low)}~{krwShort(i.high)}
                    </td>
                    <td>{pct(i.gapPct)}</td>
                    <td>
                      <span className="pos-badge">
                        <span className="glyph" aria-hidden>
                          {POSITION[i.position].glyph}
                        </span>
                        {POSITION[i.position].label}
                      </span>
                    </td>
                    <td>{i.percentile}%</td>
                    <td className="muted">{CONFIDENCE_LABEL[i.confidence]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result!.items.some((i) => i.floorAssumed) && (
            <p className="paste-hint">
              * 층이 저층/중층/고층으로만 적힌 매물은 이 단지에서 실제 거래된 층 분포로 환산했습니다.
            </p>
          )}

          <ul className="notes">
            <li>
              호가는 <b>매도 희망가</b>라 실거래가보다 높게 형성되는 것이 일반적입니다. 차이가
              양수인 것 자체가 비싸다는 뜻은 아닙니다.
            </li>
            <li>
              백분위는 추정 분포에서 그 호가의 위치입니다. 예를 들어 90%면 다음 거래가 그 값보다 낮게
              찍힐 확률이 약 90%라는 뜻입니다.
            </li>
            <li>
              동/향/조망·수리 상태·급매 여부는 반영되지 않습니다. 같은 층이라도 실제 물건 차이가
              큽니다.
            </li>
          </ul>
        </>
      )}

      {result && result.invalid.length > 0 && (
        <div className="callout" style={{ marginTop: 12 }}>
          읽지 못한 줄 {result.invalid.length}개
          <ul className="notes" style={{ marginTop: 6 }}>
            {result.invalid.slice(0, 6).map((v, k) => (
              <li key={k}>
                <code>{v.raw.slice(0, 60)}</code> — {v.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

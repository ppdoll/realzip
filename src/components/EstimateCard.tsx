'use client';

import type { Estimate } from '@/lib/types';
import { CONFIDENCE_LABEL, krw, krwShort, pct, pyeong, shortDate } from '@/lib/format';

const METHOD_LABEL: Record<Estimate['method'], string> = {
  hedonic: '면적·층 보정 회귀',
  'weighted-median': '가중 중위수',
  'region-index': '지역 지수 환산',
};

const CONFIDENCE_ICON: Record<Estimate['confidence'], string> = {
  high: '●●●',
  medium: '●●○',
  low: '●○○',
};

const CONFIDENCE_COLOR: Record<Estimate['confidence'], string> = {
  high: 'var(--good)',
  medium: 'var(--warning)',
  low: 'var(--critical)',
};

function Delta({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">표본 부족</span>;
  const cls = value > 0.05 ? 'delta-up' : value < -0.05 ? 'delta-down' : '';
  return (
    <span className={cls}>
      {value > 0.05 ? '▲' : value < -0.05 ? '▼' : '—'} {pct(Math.abs(value))}
    </span>
  );
}

export default function EstimateCard({ estimate: e }: { estimate: Estimate }) {
  const forecastDelta = ((e.forecast3m - e.price) / e.price) * 100;

  return (
    <div className="card">
      <div className="hero">
        <div className="hero-figure">
          <div className="label">
            예상 실거래가 · 전용 {e.area}㎡({pyeong(e.area)}평)
            {e.floor != null ? ` · ${e.floor}층 기준` : ''} · {e.asOf}
          </div>
          <div className="value">{krw(e.price)}</div>
          <div className="range">
            80% 예상 범위 {krwShort(e.low)} ~ {krwShort(e.high)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="badge" style={{ color: CONFIDENCE_COLOR[e.confidence] }}>
            <span aria-hidden style={{ letterSpacing: '-1px' }}>
              {CONFIDENCE_ICON[e.confidence]}
            </span>
            신뢰도 {CONFIDENCE_LABEL[e.confidence]}
          </span>
          <span className="badge">{METHOD_LABEL[e.method]}</span>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">전용 평단가</div>
          <div className="value tabular">
            {Math.round(e.pricePerPyeong).toLocaleString('ko-KR')}
            <span style={{ fontSize: 13, fontWeight: 500 }}> 만원</span>
          </div>
          <div className="foot">평(3.3㎡)당</div>
        </div>

        <div className="tile">
          <div className="label">최근 실거래</div>
          <div className="value tabular">{krwShort(e.lastDealAmount)}</div>
          <div className="foot">{e.lastDealDate ? shortDate(e.lastDealDate) : '기록 없음'}</div>
        </div>

        <div className="tile">
          <div className="label">3개월 전망</div>
          <div className="value tabular">{krwShort(e.forecast3m)}</div>
          <div className="foot">
            <Delta value={forecastDelta} />
          </div>
        </div>

        <div className="tile">
          <div className="label">지역 시세 (1년)</div>
          <div className="value">
            <Delta value={e.regionYoyPct} />
          </div>
          <div className="foot">가격지수 기준</div>
        </div>

        <div className="tile">
          <div className="label">이 단지 (1년)</div>
          <div className="value">
            <Delta value={e.complexYoyPct} />
          </div>
          <div className="foot">단지 자체 추세</div>
        </div>

        <div className="tile">
          <div className="label">유효 표본</div>
          <div className="value tabular">{e.sampleSize}</div>
          <div className="foot">최근성·면적 가중</div>
        </div>
      </div>

      {e.notes.length > 0 && (
        <ul className="notes">
          {e.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

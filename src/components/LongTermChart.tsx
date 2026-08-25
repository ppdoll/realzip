'use client';

import { useMemo, useState } from 'react';
import { ymLabel } from '@/lib/months';
import { niceTicks, useElementWidth } from './useElementWidth';

export type LongTermPoint = {
  ym: string;
  ppp: number;
  p25: number | null;
  p75: number | null;
  deals: number;
};

const M = { top: 16, right: 14, bottom: 26, left: 56 };
const HEIGHT = 240;

/**
 * 지역 장기 평단가 흐름 (최대 10년).
 *
 * 형태: 시간에 따른 변화 -> 선. 그 달의 흩어짐은 밴드(p25~p75)로 겹쳐 둔다.
 * 밴드를 그리는 이유: 중위선만 보면 "그 달 가격은 하나" 로 읽히는데, 실제로는
 * 같은 달 안에서도 단지·평형에 따라 두세 배씩 벌어진다. 밴드가 있어야
 * 중위선이 대표값일 뿐이라는 게 보인다.
 *
 * 원본 거래는 3년만 들고 있고 이 그림은 월별 요약만으로 그린다 —
 * 자세한 이유는 src/lib/region-index.ts 주석에 있다.
 */
export default function LongTermChart({
  points,
  regionName,
}: {
  points: LongTermPoint[];
  regionName: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const model = useMemo(() => {
    if (points.length < 6) return null;
    const ys = points.flatMap((p) => [p.ppp, p.p25 ?? p.ppp, p.p75 ?? p.ppp]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = (hi - lo) * 0.08 || hi * 0.05;
    return { yLo: Math.max(0, lo - pad), yHi: hi + pad };
  }, [points]);

  if (!model) {
    return (
      <div className="callout">
        이 지역은 아직 장기 흐름을 쌓지 않았습니다. 담기면 최대 10년치가 여기 나옵니다.
      </div>
    );
  }

  const w = Math.max(width, 320);
  const innerW = w - M.left - M.right;
  const innerH = HEIGHT - M.top - M.bottom;
  const x = (i: number) => M.left + (innerW * i) / Math.max(points.length - 1, 1);
  const y = (v: number) =>
    M.top + innerH - (innerH * (v - model.yLo)) / Math.max(model.yHi - model.yLo, 1);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.ppp).toFixed(1)}`).join(' ');
  const band =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.p75 ?? p.ppp).toFixed(1)}`).join(' ') +
    ' ' +
    [...points]
      .reverse()
      .map((p, i) => `L${x(points.length - 1 - i).toFixed(1)} ${y(p.p25 ?? p.ppp).toFixed(1)}`)
      .join(' ') +
    ' Z';

  const ticks = niceTicks(model.yLo, model.yHi, 4);
  // 연 단위로만 x축을 적는다 — 120개월을 다 적으면 읽을 수 없다
  const yearMarks = points
    .map((p, i) => ({ i, year: p.ym.slice(0, 4), isJan: p.ym.slice(4) === '01' }))
    .filter((m) => m.isJan);

  const first = points[0];
  const last = points[points.length - 1];
  const changePct = Math.round(((last.ppp - first.ppp) / first.ppp) * 1000) / 10;
  const h = hover != null ? points[hover] : null;

  return (
    <div ref={ref}>
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${HEIGHT}`}
        role="img"
        aria-label={`${regionName} 월별 전용 평단가. ${ymLabel(first.ym)} ${Math.round(first.ppp).toLocaleString('ko-KR')}만원에서 ${ymLabel(last.ym)} ${Math.round(last.ppp).toLocaleString('ko-KR')}만원으로 ${changePct}% 변했습니다.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * w;
          const i = Math.round(((px - M.left) / Math.max(innerW, 1)) * (points.length - 1));
          setHover(i >= 0 && i < points.length ? i : null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={w - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {Math.round(t).toLocaleString('ko-KR')}
            </text>
          </g>
        ))}

        {yearMarks.map((m) => (
          <text key={m.i} x={x(m.i)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
            {m.year}
          </text>
        ))}

        <path d={band} fill="var(--series-1-wash)" stroke="none" />
        <path d={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" />

        {h && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={M.top} y2={M.top + innerH} stroke="var(--text-muted)" strokeWidth={1} />
            <circle cx={x(hover!)} cy={y(h.ppp)} r={4.5} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
          </g>
        )}
      </svg>

      <div className="lt-foot">
        {h ? (
          <span className="tabular">
            <b>{ymLabel(h.ym)}</b> 평단 {Math.round(h.ppp).toLocaleString('ko-KR')}만
            {h.p25 != null && h.p75 != null && (
              <span className="muted">
                {' '}
                (가운데 절반 {Math.round(h.p25).toLocaleString('ko-KR')}~
                {Math.round(h.p75).toLocaleString('ko-KR')}만) · {h.deals}건
              </span>
            )}
          </span>
        ) : (
          <span className="tabular">
            {ymLabel(first.ym)} {Math.round(first.ppp).toLocaleString('ko-KR')}만 →{' '}
            {ymLabel(last.ym)} {Math.round(last.ppp).toLocaleString('ko-KR')}만{' '}
            <b className={changePct >= 0 ? 'delta-up' : 'delta-down'}>
              {changePct >= 0 ? '+' : ''}
              {changePct}%
            </b>
            <span className="muted"> · {points.length}개월</span>
          </span>
        )}
      </div>
    </div>
  );
}

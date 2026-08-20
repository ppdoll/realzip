'use client';

import { useMemo, useState } from 'react';
import type { IndexPoint } from '@/lib/types';
import { ymLabel } from '@/lib/months';
import { median } from '@/lib/stats';
import { niceTicks, useElementWidth } from './useElementWidth';

const M = { top: 16, right: 14, bottom: 26, left: 52 };
const HEIGHT = 220;

/**
 * 시군구 월별 전용 평단가 추이.
 *  · 점  = 그 달의 절사중위 평단가 (실측, 거래 구성에 따라 흔들린다)
 *  · 선  = 같은 단지·같은 평형 안의 상대 변동만 뽑아 만든 가격지수 추세
 */
export default function IndexChart({ index }: { index: IndexPoint[] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const model = useMemo(() => {
    // 지수(무차원)를 평단가 수준으로 맞추는 배율 — 관측치와 가장 잘 맞는 스케일
    const ratios = index
      .filter((p) => p.medianPricePerPyeong != null && p.index > 0)
      .map((p) => p.medianPricePerPyeong! / (p.index / 100));
    const level = ratios.length > 0 ? median(ratios) : null;

    const trend = index.map((p, i) => ({ i, y: level != null ? (level * p.index) / 100 : null }));
    const dots = index
      .map((p, i) => ({ i, y: p.medianPricePerPyeong, count: p.count }))
      .filter((d): d is { i: number; y: number; count: number } => d.y != null);

    const ys = [...dots.map((d) => d.y), ...trend.map((t) => t.y)].filter(
      (v): v is number => v != null && Number.isFinite(v),
    );
    if (ys.length < 2) return null;
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const pad = (hi - lo) * 0.15 || hi * 0.08;
    return { trend, dots, yLo: Math.max(0, lo - pad), yHi: hi + pad };
  }, [index]);

  if (!model) {
    return <div className="callout">가격지수를 만들 거래가 부족합니다.</div>;
  }

  const innerW = Math.max(120, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const xOf = (i: number) => M.left + (i / Math.max(1, index.length - 1)) * innerW;
  const yOf = (v: number) => M.top + innerH - ((v - model.yLo) / (model.yHi - model.yLo)) * innerH;

  const yTicks = niceTicks(model.yLo, model.yHi, 4);
  const xTicks = index
    .map((p, i) => ({ i, ym: p.ym }))
    .filter(({ ym }) => ym.slice(4, 6) === '01' || ym.slice(4, 6) === '07');

  const trendPath = model.trend
    .filter((t) => t.y != null)
    .map((t, k) => `${k === 0 ? 'M' : 'L'}${xOf(t.i).toFixed(1)},${yOf(t.y!).toFixed(1)}`)
    .join(' ');

  const hovered = hoverIdx != null ? index[hoverIdx] : null;
  const hoveredTrend = hoverIdx != null ? model.trend[hoverIdx]?.y : null;

  return (
    <div>
      <ul className="legend">
        <li>
          <span className="key-dot" style={{ background: 'var(--series-1)' }} />
          월별 중위 평단가 (실측)
        </li>
        <li>
          <span className="key-line" style={{ background: 'var(--series-2)' }} />
          가격지수 추세
        </li>
      </ul>

      <div className="chart-wrap" ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="시군구 월별 전용 평단가 추이"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const i = Math.round(((mx - M.left) / innerW) * (index.length - 1));
            setHoverIdx(i >= 0 && i < index.length ? i : null);
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={M.left}
                x2={M.left + innerW}
                y1={yOf(v)}
                y2={yOf(v)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
              <text
                x={M.left - 8}
                y={yOf(v)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(v).toLocaleString('ko-KR')}
              </text>
            </g>
          ))}
          <text x={M.left - 8} y={M.top - 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
            만원/평
          </text>

          {xTicks.map(({ i, ym }) => (
            <text
              key={ym}
              x={xOf(i)}
              y={HEIGHT - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {ymLabel(ym)}
            </text>
          ))}

          <path
            d={trendPath}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {model.dots.map((d) => (
            <circle
              key={d.i}
              cx={xOf(d.i)}
              cy={yOf(d.y)}
              r={4}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          ))}

          {hoverIdx != null && (
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={M.top}
              y2={M.top + innerH}
              stroke="var(--text-muted)"
              strokeWidth={1}
              opacity={0.5}
            />
          )}
        </svg>

        {hovered && (
          <div
            className="tooltip"
            style={{
              left: Math.min(Math.max(xOf(hoverIdx!), 88), width - 88),
              top: M.top + 34,
            }}
          >
            <div className="t-head">{ymLabel(hovered.ym)}</div>
            <div className="t-row">
              <span>중위 평단가</span>
              <b>
                {hovered.medianPricePerPyeong != null
                  ? `${Math.round(hovered.medianPricePerPyeong).toLocaleString('ko-KR')}만원`
                  : '표본 부족'}
              </b>
            </div>
            <div className="t-row">
              <span>지수 추세</span>
              <b>
                {hoveredTrend != null
                  ? `${Math.round(hoveredTrend).toLocaleString('ko-KR')}만원`
                  : '—'}
              </b>
            </div>
            <div className="t-row">
              <span>거래 건수</span>
              <b>{hovered.count}건</b>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

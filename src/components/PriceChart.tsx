'use client';

import { useMemo, useState } from 'react';
import type { Estimate, IndexPoint, Trade } from '@/lib/types';
import { krw, krwShort, shortDate } from '@/lib/format';
import { monthDiff, ymLabel } from '@/lib/months';
import { median } from '@/lib/stats';
import { niceTicks, useElementWidth } from './useElementWidth';

const M = { top: 18, right: 16, bottom: 28, left: 56 };
const HEIGHT = 320;
const FORECAST_MONTHS = 3;

type Props = {
  /** 선택한 평형의 실거래 (해제 건 포함 — 해제는 흐리게 표시) */
  trades: Trade[];
  index: IndexPoint[];
  estimate: Estimate;
  /**
   * 사용자가 입력한 매물 호가 (만원). 시간축에 얹으면 "현재 호가"가 마치 미래
   * 시점 값처럼 보이므로, 가로 기준선으로만 깔아서 "호가가 과거 어느 시점
   * 가격 수준인지"를 읽게 한다.
   */
  listings?: number[];
};

type Point = { t: number; y: number; trade: Trade };

function daysInMonth(ym: string): number {
  return new Date(Number(ym.slice(0, 4)), Number(ym.slice(4, 6)), 0).getDate();
}

export default function PriceChart({ trades, index, estimate, listings = [] }: Props) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; point?: Point; t: number } | null>(
    null,
  );

  const model = useMemo(() => {
    const startYm = index[0]?.ym;
    const endYm = index[index.length - 1]?.ym;
    if (!startYm || !endYm) return null;

    const lastMonth = index.length - 1;
    const tMax = lastMonth + FORECAST_MONTHS;

    // 실거래 점: x = 계약일 기준 월 소수좌표
    const points: Point[] = trades
      .map((tr) => {
        const t = monthDiff(startYm, tr.dealYm) + (Number(tr.dealDate.slice(8, 10)) - 1) / daysInMonth(tr.dealYm);
        return { t, y: tr.amount, trade: tr };
      })
      .filter((p) => p.t >= -0.5 && p.t <= lastMonth + 0.5);

    // 추정 시세 곡선: 현재 예상가에 지역 가격지수 비율을 곱해 과거로 되돌린다.
    const fitted = index.map((p, i) => ({ t: i, y: (estimate.price * p.index) / 100 }));

    // 3개월 전망: 현재 예상가 → forecast3m 선형 연결
    const forecast = Array.from({ length: FORECAST_MONTHS + 1 }, (_, k) => ({
      t: lastMonth + k,
      y: estimate.price + ((estimate.forecast3m - estimate.price) * k) / FORECAST_MONTHS,
    }));

    // 예측구간: 현재 시점 구간에서 시작해 전망 구간으로 갈수록 넓어진다.
    const halfLow = estimate.price - estimate.low;
    const halfHigh = estimate.high - estimate.price;
    const band = forecast.map((f, k) => {
      const widen = 1 + (0.25 * k) / FORECAST_MONTHS;
      return { t: f.t, lo: f.y - halfLow * widen, hi: f.y + halfHigh * widen };
    });

    const ask =
      listings.length > 0
        ? {
            min: Math.min(...listings),
            med: median(listings),
            max: Math.max(...listings),
          }
        : null;

    const ys = [
      ...points.map((p) => p.y),
      ...fitted.map((f) => f.y),
      ...band.map((b) => b.lo),
      ...band.map((b) => b.hi),
      ...(ask ? [ask.min, ask.max] : []),
    ].filter((v) => Number.isFinite(v) && v > 0);

    if (ys.length === 0) return null;
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const pad = (yMax - yMin) * 0.12 || yMax * 0.08;

    return {
      startYm,
      lastMonth,
      tMax,
      points,
      fitted,
      forecast,
      band,
      ask,
      yLo: Math.max(0, yMin - pad),
      yHi: yMax + pad,
    };
  }, [trades, index, estimate, listings]);

  if (!model) {
    return (
      <div ref={ref} className="callout">
        차트를 그릴 데이터가 부족합니다.
      </div>
    );
  }

  const innerW = Math.max(120, width - M.left - M.right);
  const innerH = HEIGHT - M.top - M.bottom;
  const xOf = (t: number) => M.left + (t / model.tMax) * innerW;
  const yOf = (v: number) =>
    M.top + innerH - ((v - model.yLo) / (model.yHi - model.yLo)) * innerH;

  const yTicks = niceTicks(model.yLo, model.yHi, 5);
  const xTicks = index
    .map((p, i) => ({ i, ym: p.ym }))
    .filter(({ ym }) => ym.slice(4, 6) === '01' || ym.slice(4, 6) === '07');

  const linePath = (pts: { t: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(1)},${yOf(p.y).toFixed(1)}`).join(' ');

  const bandPath =
    `M${xOf(model.band[0].t)},${yOf(model.band[0].hi)} ` +
    model.band.slice(1).map((b) => `L${xOf(b.t)},${yOf(b.hi)}`).join(' ') +
    ' ' +
    [...model.band].reverse().map((b) => `L${xOf(b.t)},${yOf(b.lo)}`).join(' ') +
    ' Z';

  // 클로저 안에서는 model 의 null 좁히기가 유지되지 않으므로 별칭을 잡아둔다.
  const chart = model;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < M.left - 8 || mx > M.left + innerW + 8) return setHover(null);

    // 커서에서 20px 안에 있는 실거래 점을 우선 집는다.
    let best: Point | undefined;
    let bestD = 22;
    for (const p of chart.points) {
      const d = Math.hypot(xOf(p.t) - mx, yOf(p.y) - my);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    const t = Math.max(0, Math.min(chart.tMax, ((mx - M.left) / innerW) * chart.tMax));
    setHover({ x: best ? xOf(best.t) : mx, y: best ? yOf(best.y) : my, point: best, t });
  }

  const hoveredMonth = hover ? Math.round(hover.t) : null;
  const monthTrades =
    hoveredMonth != null && !hover?.point
      ? model.points.filter((p) => Math.round(p.t) === hoveredMonth)
      : [];
  const fittedAt =
    hoveredMonth != null
      ? hoveredMonth <= model.lastMonth
        ? model.fitted[hoveredMonth]?.y
        : model.forecast.find((f) => f.t === hoveredMonth)?.y
      : undefined;

  return (
    <div>
      <ul className="legend">
        <li>
          <span className="key-dot" style={{ background: 'var(--series-1)' }} />
          실거래 {trades.length}건
        </li>
        <li>
          <span className="key-line" style={{ background: 'var(--series-2)' }} />
          추정 시세
        </li>
        <li>
          <span className="key-band" style={{ background: 'var(--series-2-wash)' }} />
          예상 구간 (80%) · 3개월 전망
        </li>
        {listings.length > 0 && (
          <li>
            <span className="key-line" style={{ background: 'var(--series-3)' }} />
            매물 호가 {listings.length}건 (중위선·범위)
          </li>
        )}
      </ul>

      <div className="chart-wrap" ref={ref}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`최근 3년 실거래가 추이와 예상 실거래가 ${krw(estimate.price)}`}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* 격자 + y축 */}
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
                {krwShort(v)}
              </text>
            </g>
          ))}

          {/* x축 */}
          {xTicks.map(({ i, ym }) => (
            <text
              key={ym}
              x={xOf(i)}
              y={HEIGHT - 9}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {ymLabel(ym)}
            </text>
          ))}

          {/* 매물 호가 범위 — 가로 띠 + 중위선 (시간축과 무관한 현재 값) */}
          {model.ask && (
            <g>
              {model.ask.max > model.ask.min && (
                <rect
                  x={M.left}
                  y={yOf(model.ask.max)}
                  width={innerW}
                  height={Math.max(1, yOf(model.ask.min) - yOf(model.ask.max))}
                  fill="var(--series-3-wash)"
                />
              )}
              <line
                x1={M.left}
                x2={M.left + innerW}
                y1={yOf(model.ask.med)}
                y2={yOf(model.ask.med)}
                stroke="var(--series-3)"
                strokeWidth={2}
              />
              <text
                x={M.left + 6}
                y={yOf(model.ask.med) - 6}
                fontSize={11.5}
                fontWeight={620}
                fill="var(--text-primary)"
              >
                호가 중위 {krwShort(model.ask.med)}
              </text>
            </g>
          )}

          {/* 예측 구간 밴드 */}
          <path d={bandPath} fill="var(--series-2-wash)" />

          {/* 현재 시점 구분선 */}
          <line
            x1={xOf(model.lastMonth)}
            x2={xOf(model.lastMonth)}
            y1={M.top}
            y2={M.top + innerH}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text
            x={xOf(model.lastMonth) + 5}
            y={M.top + 10}
            fontSize={10.5}
            fill="var(--text-muted)"
          >
            전망
          </text>

          {/* 추정 시세 (과거) */}
          <path
            d={linePath(model.fitted)}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {/* 3개월 전망 */}
          <path
            d={linePath(model.forecast)}
            fill="none"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinecap="round"
          />

          {/* 실거래 점 — 표면색 링으로 겹침을 견딘다 */}
          {model.points.map((p, i) => (
            <circle
              key={`${p.trade.dealDate}-${p.trade.floor}-${i}`}
              cx={xOf(p.t)}
              cy={yOf(p.y)}
              r={4.5}
              fill={p.trade.canceled ? 'var(--surface-2)' : 'var(--series-1)'}
              stroke="var(--surface-1)"
              strokeWidth={2}
              opacity={p.trade.canceled ? 0.8 : 1}
            />
          ))}

          {/* 현재 예상가 마커 + 직접 라벨 */}
          <circle
            cx={xOf(model.lastMonth)}
            cy={yOf(estimate.price)}
            r={5}
            fill="var(--series-2)"
            stroke="var(--surface-1)"
            strokeWidth={2}
          />
          <text
            x={xOf(model.lastMonth) - 8}
            y={yOf(estimate.price) - 10}
            textAnchor="end"
            fontSize={12}
            fontWeight={650}
            fill="var(--text-primary)"
          >
            {krwShort(estimate.price)}
          </text>

          {/* 크로스헤어 */}
          {hover && (
            <line
              x1={hover.x}
              x2={hover.x}
              y1={M.top}
              y2={M.top + innerH}
              stroke="var(--text-muted)"
              strokeWidth={1}
              opacity={0.5}
            />
          )}
        </svg>

        {hover && (
          <div
            className="tooltip"
            style={{
              left: Math.min(Math.max(hover.x, 90), width - 90),
              top: hover.point ? hover.y : M.top + 40,
            }}
          >
            {hover.point ? (
              <>
                <div className="t-head">{shortDate(hover.point.trade.dealDate)} 실거래</div>
                <div className="t-row">
                  <span>거래가</span>
                  <b>{krw(hover.point.trade.amount)}</b>
                </div>
                <div className="t-row">
                  <span>층 · 면적</span>
                  <b>
                    {hover.point.trade.floor ?? '—'}층 · {hover.point.trade.area}㎡
                  </b>
                </div>
                <div className="t-row">
                  <span>유형</span>
                  <b>{hover.point.trade.dealingGbn ?? '—'}</b>
                </div>
                {hover.point.trade.canceled && (
                  <div className="t-row">
                    <span>상태</span>
                    <b>해제</b>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="t-head">
                  {hoveredMonth != null && hoveredMonth <= model.lastMonth
                    ? ymLabel(index[hoveredMonth]?.ym ?? '')
                    : `${hoveredMonth != null ? hoveredMonth - model.lastMonth : 0}개월 후 전망`}
                </div>
                <div className="t-row">
                  <span>추정 시세</span>
                  <b>{krw(fittedAt)}</b>
                </div>
                <div className="t-row">
                  <span>실거래</span>
                  <b>{monthTrades.length}건</b>
                </div>
                {monthTrades.slice(0, 3).map((p, i) => (
                  <div className="t-row" key={i}>
                    <span>{p.trade.floor ?? '—'}층</span>
                    <b>{krw(p.trade.amount)}</b>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

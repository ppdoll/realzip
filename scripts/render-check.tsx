/**
 * 차트 컴포넌트가 실제로 유효한 SVG 를 뱉는지 서버 렌더로 확인한다.
 * API 키 없이 돌아가고, 좌표에 NaN 이 새는 부류의 회귀를 잡아준다.
 *
 *   npm run render:check
 */
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import PriceChart from '@/components/PriceChart';
import IndexChart from '@/components/IndexChart';
import EstimateCard from '@/components/EstimateCard';
import { buildRegionIndex, estimate } from '@/lib/estimate';
import { recentMonths } from '@/lib/months';
import { PYEONG } from '@/lib/stats';
import type { Trade } from '@/lib/types';

const MONTHS = recentMonths(36);
let seed = 42;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

const trades: Trade[] = [];
for (let c = 0; c < 20; c++) {
  for (const area of [59.94, 84.97]) {
    MONTHS.forEach((ym, mi) => {
      if (rand() > 0.4) return;
      const ppp = (3500 + c * 120) * (1 + 0.007) ** mi * (1 + (rand() - 0.5) * 0.06);
      trades.push({
        aptSeq: `11680-${c}`,
        lawdCd: '11680',
        umdNm: '대치동',
        aptNm: `단지${c}`,
        jibun: '1',
        roadNm: null,
        buildYear: 2000 + (c % 20),
        area,
        floor: 1 + Math.floor(rand() * 20),
        dealDate: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-15`,
        dealYm: ym,
        amount: Math.round((ppp * area) / PYEONG),
        dealingGbn: '중개거래',
        buyerGbn: '개인',
        slerGbn: '개인',
        canceled: false,
        rgstDate: null,
      });
    });
  }
}

const from = MONTHS[0];
const to = MONTHS[MONTHS.length - 1];
const index = buildRegionIndex(trades, from, to);
const target = trades.filter((t) => t.aptSeq === '11680-7');
const est = estimate({ regionTrades: trades, complexTrades: target, index, area: 84.97, floor: 12 });
if (!est) throw new Error('estimate 실패');

const chartTrades = target.filter((t) => Math.abs(t.area - 84.97) < 1.5);

const checks: [string, boolean, string][] = [];

const price = renderToStaticMarkup(
  React.createElement(PriceChart, { trades: chartTrades, index, estimate: est }),
);
const pathCount = (price.match(/<path /g) ?? []).length;
const circleCount = (price.match(/<circle /g) ?? []).length;
const badNums = /(NaN|Infinity|undefined)/.test(price);
checks.push(['PriceChart path 3개 이상 (밴드+과거선+전망선)', pathCount >= 3, `${pathCount}개`]);
checks.push(['PriceChart 실거래 점 렌더', circleCount >= chartTrades.length, `${circleCount}개 / 거래 ${chartTrades.length}건`]);
checks.push(['PriceChart 좌표에 NaN/undefined 없음', !badNums, badNums ? '발견' : '없음']);
checks.push(['PriceChart 범례 3항목', (price.match(/<li>/g) ?? []).length >= 3, `${(price.match(/<li>/g) ?? []).length}개`]);
checks.push(['PriceChart y축 눈금 라벨', /억|만/.test(price), 'ok']);

const idx = renderToStaticMarkup(React.createElement(IndexChart, { index }));
checks.push(['IndexChart 추세선 렌더', /<path d="M[\d.]+/.test(idx), 'ok']);
checks.push(['IndexChart 월별 점 렌더', (idx.match(/<circle /g) ?? []).length >= 24, `${(idx.match(/<circle /g) ?? []).length}개`]);
checks.push(['IndexChart NaN 없음', !/(NaN|Infinity)/.test(idx), 'ok']);

const card = renderToStaticMarkup(React.createElement(EstimateCard, { estimate: est }));
checks.push(['EstimateCard 히어로 숫자', /hero-figure/.test(card) && /억/.test(card), 'ok']);
checks.push(['EstimateCard 타일 6개', (card.match(/class="tile"/g) ?? []).length === 6, `${(card.match(/class="tile"/g) ?? []).length}개`]);
checks.push(['EstimateCard NaN 없음', !/(NaN|Infinity|undefined)/.test(card), 'ok']);

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) failed++;
}
console.log(`\n예상가 ${est.price.toLocaleString('ko-KR')}만원 · 구간 ${est.low.toLocaleString('ko-KR')}~${est.high.toLocaleString('ko-KR')} · ${est.method}`);
console.log(failed === 0 ? '\n렌더 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

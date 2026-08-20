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
import DistBar from '@/components/DistBar';
import FactsCard from '@/components/FactsCard';
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

// ── DistBar: 표시가 띠 밖으로 나가지 않는지 (0~100% 안) ──
// 값이 분포 밖으로 크게 벗어나는 경우가 실제로 흔하다 (은마 회전율은 p25 보다 낮다).
// 그래서 축 범위 계산이 이 단지 값까지 담는지 양쪽 극단으로 확인한다.
const DIST = { count: 196, median: 2, p25: 1.1, p75: 3.5 };
const DIST_CASES: [string, number][] = [
  ['분포 아래', 0.1],
  ['p25 바로 아래', 1.0],
  ['중위', 2],
  ['분포 위', 12.4],
  ['0', 0],
  // 실측 극단값 — 강서구 더트루엘마곡HQ (2024 준공 신축, 86건/148세대)
  ['신축 입주장', 58.1],
];
for (const [name, value] of DIST_CASES) {
  const html = renderToStaticMarkup(
    React.createElement(DistBar, {
      pos: { value, distribution: DIST, percentile: 16, vsMedian: 0.5 },
      regionLabel: '강남구',
    }),
  );
  const lefts = [...html.matchAll(/left:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
  const widths = [...html.matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
  const inBounds =
    lefts.length === 3 && lefts.every((v) => v >= 0 && v <= 100) && widths.every((w) => w > 0);
  // 가운데 절반 띠는 극단값이 있어도 읽을 수 있는 폭이어야 한다 (축을 값에 맞추면 짜부라진다)
  const bandWidth = widths[0] ?? 0;
  checks.push([
    `DistBar 표시가 띠 안에 (${name} ${value}%)`,
    inBounds && !/(NaN|Infinity|undefined)/.test(html),
    lefts.map((v) => v.toFixed(1)).join(' / '),
  ]);
  checks.push([
    `DistBar 가운데 절반 띠 폭 15% 이상 (${name} ${value}%)`,
    bandWidth >= 15,
    `${bandWidth.toFixed(1)}%`,
  ]);
}
// 범위를 벗어난 값은 점이 아니라 방향 삼각형으로 붙어야 한다 —
// 끝에 점을 찍으면 "여기 있다" 로 읽히는데 실제로는 더 멀리 있다.
const offHtml = renderToStaticMarkup(
  React.createElement(DistBar, {
    pos: { value: 58.1, distribution: DIST, percentile: 99, vsMedian: 29 },
    regionLabel: '강서구',
  }),
);
checks.push(['DistBar 범위 밖은 삼각형', /distbar-off high/.test(offHtml) && !/distbar-dot/.test(offHtml), 'ok']);
checks.push(['DistBar 범위 밖 표기', /범위 밖/.test(offHtml), 'ok']);
const inHtml = renderToStaticMarkup(
  React.createElement(DistBar, {
    pos: { value: 2.5, distribution: DIST, percentile: 60, vsMedian: 1.3 },
    regionLabel: '강남구',
  }),
);
checks.push(['DistBar 범위 안은 점', /distbar-dot/.test(inHtml) && !/distbar-off/.test(inHtml), 'ok']);

// 범례는 색 말고 모양도 쓰므로 세 표시가 모두 있어야 한다
const distHtml = renderToStaticMarkup(
  React.createElement(DistBar, {
    pos: { value: 0.9, distribution: DIST, percentile: 16, vsMedian: 0.5 },
    regionLabel: '강남구',
  }),
);
checks.push([
  'DistBar 범례 3종 (점·선·띠)',
  /k-dot/.test(distHtml) && /k-median/.test(distHtml) && /k-band/.test(distHtml),
  'ok',
]);
checks.push([
  'DistBar 자릿수 고정 (2 가 아니라 2.0)',
  /2\.0%/.test(distHtml) && !/>2%/.test(distHtml),
  'ok',
]);

// ── FactsCard: 세대 규모 구성 (값이 없으면 접혀야 한다) ──
const FACTS_BASE = {
  kaptCode: 'A1', kaptName: '은마', addr: '서울특별시 강남구 대치동 316 은마',
  roadAddr: null, households: 4424, dongCnt: 28, topFloor: 14, elevatorCnt: 42,
  approvedAt: '1979-08-30', heatNm: '지역난방', hallNm: '복도식', mgrNm: '위탁관리',
  saleNm: '분양', builder: '한보', turnoverPct: 0.9, saleCount12m: 38,
  rentReportPct: 20.9, rentCount12m: 926, privRatioPct: 70,
  areaPerHousehold: 79.8, pyeongPerHousehold: 24,
};
const renderFacts = (facts: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    React.createElement(FactsCard, {
      data: { matched: true, window: { from: '202509', months: 12 }, facts, turnoverLabel: null, turnover: null, mergedBlocks: null, ...extra } as never,
      loading: false, error: null, regionLabel: '강남구',
    }),
  );

// 은마 실제 값 — 85 이하 24, 85~135 4,400
const mixHtml = renderFacts({
  ...FACTS_BASE, aptKind: '아파트',
  unitMix: {
    bands: [
      { label: '60㎡ 이하', units: 0, pct: 0 },
      { label: '60~85㎡', units: 24, pct: 0.5 },
      { label: '85~135㎡', units: 4400, pct: 99.5 },
      { label: '135㎡ 초과', units: 0, pct: 0 },
    ],
    total: 4424, allSmall: false, smallPct: 0,
  },
});
const segs = (mixHtml.match(/class="mix-seg/g) ?? []).length;
checks.push(['FactsCard 세대 구성 칸은 0세대를 빼고 그린다', segs === 2, `${segs}칸`]);
checks.push(['FactsCard 세대 구성 폭 합 100%', /width:99\.5%/.test(mixHtml) && /width:0\.5%/.test(mixHtml), 'ok']);
checks.push(['FactsCard 세대 구성 범례', (mixHtml.match(/class="mix-key"/g) ?? []).length === 2, 'ok']);
checks.push(['FactsCard 세대 구성 NaN 없음', !/(NaN|Infinity|undefined)/.test(mixHtml), 'ok']);

// 값이 없으면 그 줄이 아예 없어야 한다 (서울은 8/23 재수집 전까지 null 이다)
const noMix = renderFacts({ ...FACTS_BASE, aptKind: null, unitMix: null });
checks.push(['FactsCard 구성 없으면 접힌다', !/mixbar/.test(noMix) && /단지 정보/.test(noMix), 'ok']);

// 원룸형·주상복합 신호가 각주로 나와야 한다
const smallHtml = renderFacts({
  ...FACTS_BASE, households: 149, aptKind: '아파트',
  unitMix: { bands: [{ label: '60㎡ 이하', units: 149, pct: 100 }, { label: '60~85㎡', units: 0, pct: 0 }, { label: '85~135㎡', units: 0, pct: 0 }, { label: '135㎡ 초과', units: 0, pct: 0 }], total: 149, allSmall: true, smallPct: 100 },
});
checks.push(['FactsCard 전 세대 소형이면 안내', /전 세대가 전용 60㎡ 이하/.test(smallHtml), 'ok']);
const mixedHtml = renderFacts({ ...FACTS_BASE, aptKind: '주상복합', unitMix: null });
checks.push(['FactsCard 주상복합이면 안내', /주상복합입니다/.test(mixedHtml), 'ok']);
checks.push(['FactsCard 아파트면 주상복합 안내 없음', !/주상복합입니다/.test(mixHtml), 'ok']);

let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) failed++;
}
console.log(`\n예상가 ${est.price.toLocaleString('ko-KR')}만원 · 구간 ${est.low.toLocaleString('ko-KR')}~${est.high.toLocaleString('ko-KR')} · ${est.method}`);
console.log(failed === 0 ? '\n렌더 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

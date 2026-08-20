/**
 * 추정 엔진 자체 검증 — API 키 없이 돌아간다.
 *
 *   npm run smoke
 *
 * 진짜 가격 궤적을 알고 있는 가상의 시군구를 만들고,
 * 가격지수와 예상 실거래가가 그 진짜 값을 되찾아내는지 확인한다.
 */
import { compareListings, parseListings } from '../src/lib/compare';
import { buildRegionIndex, estimate } from '../src/lib/estimate';
import { recentMonths } from '../src/lib/months';
import { PYEONG } from '../src/lib/stats';
import type { Trade } from '../src/lib/types';

// 재현 가능한 난수 (mulberry32)
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = Number(process.env.SMOKE_SEED ?? 20260819);
const rand = rng(SEED);
const gauss = () => {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

const MONTHS = recentMonths(36);
const ANNUAL_GROWTH = 0.09; // 진짜 시장: 연 +9%
const MONTHLY = (1 + ANNUAL_GROWTH) ** (1 / 12) - 1;

/** 진짜 시장 수준 (마지막 달 = 1.0) */
function trueLevel(monthIdx: number): number {
  return (1 + MONTHLY) ** (monthIdx - (MONTHS.length - 1));
}

const AREAS = [59.94, 84.97, 114.53];
const TARGET_APT = 'SEQ-007';
const TARGET_AREA = 84.97;
const TARGET_FLOOR = 12;
/** 대상 단지·평형의 기준 평단가 (만원/평, 마지막 달) */
const TRUE_PPP = 6200;

function buildTrades(): Trade[] {
  const out: Trade[] = [];
  for (let c = 0; c < 30; c++) {
    const aptSeq = `SEQ-${String(c).padStart(3, '0')}`;
    // 단지 고유 수준: 대상 단지는 정확히 TRUE_PPP
    const basePpp = aptSeq === TARGET_APT ? TRUE_PPP : 3200 + rand() * 5200;
    for (const area of AREAS) {
      // 큰 평형은 평단가가 조금 낮은 흔한 패턴
      const areaFactor = (84.97 / area) ** 0.12;
      MONTHS.forEach((ym, mi) => {
        const deals = rand() < 0.45 ? 1 + Math.floor(rand() * 2) : 0;
        for (let d = 0; d < deals; d++) {
          const floor = 1 + Math.floor(rand() * 22);
          const floorFactor = 1 + (Math.min(floor, 20) - 10) * 0.004;
          const noise = Math.exp(gauss() * 0.035);
          const ppp = basePpp * areaFactor * floorFactor * trueLevel(mi) * noise;
          const amount = Math.round(((ppp * area) / PYEONG) / 10) * 10;
          out.push({
            aptSeq,
            lawdCd: '11680',
            umdNm: '테스트동',
            aptNm: `테스트${c}단지`,
            jibun: '1',
            roadNm: null,
            buildYear: 2005,
            area,
            floor,
            dealDate: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`,
            dealYm: ym,
            amount,
            dealingGbn: rand() < 0.05 ? '직거래' : '중개거래',
            buyerGbn: '개인',
            slerGbn: '개인',
            canceled: rand() < 0.01,
            rgstDate: null,
          });
        }
      });
    }
  }
  return out;
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

const trades = buildTrades();
const from = MONTHS[0];
const to = MONTHS[MONTHS.length - 1];
console.log(`가상 시군구: 단지 30곳 · 거래 ${trades.length}건 · ${from}~${to}`);
console.log(`진짜 시장 성장률: 연 +${(ANNUAL_GROWTH * 100).toFixed(1)}%\n`);

// ── 1. 가격지수가 진짜 궤적을 되찾는가 ──
const index = buildRegionIndex(trades, from, to);
const idxYoy = (index[index.length - 1].index / index[index.length - 13].index - 1) * 100;
console.log(`가격지수 최근 1년: ${idxYoy >= 0 ? '+' : ''}${idxYoy.toFixed(2)}%  (기대 +9.00%)`);

let worst = 0;
index.forEach((p, i) => {
  const expected = trueLevel(i) * 100;
  worst = Math.max(worst, Math.abs(p.index - expected) / expected);
});
console.log(`지수 전 구간 최대 오차: ${(worst * 100).toFixed(2)}%`);

// 연간 변동률은 두 시점만 비교하므로 표본잡음이 지배한다 (시드별 ±2%p).
// 편향 없이 진짜 값 주변에 흩어지는지만 본다 — 계열 전체 오차는 아래에서 따로 본다.
if (Math.abs(idxYoy - ANNUAL_GROWTH * 100) > 3) {
  fail(`지수 연간 변동률이 진짜 값에서 3%p 이상 벗어났습니다 (${idxYoy.toFixed(2)}%).`);
}
if (worst > 0.04) {
  fail(`지수가 진짜 궤적에서 4% 이상 벗어났습니다 (${(worst * 100).toFixed(2)}%).`);
}

// ── 2. 예상 실거래가가 진짜 값을 되찾는가 ──
const complexTrades = trades.filter((t) => t.aptSeq === TARGET_APT);
const est = estimate({
  regionTrades: trades,
  complexTrades,
  index,
  area: TARGET_AREA,
  floor: TARGET_FLOOR,
});
if (!est) fail('예상 시세를 계산하지 못했습니다.');

const truePpp = TRUE_PPP * (1 + (Math.min(TARGET_FLOOR, 20) - 10) * 0.004);
const truePrice = (truePpp * TARGET_AREA) / PYEONG;
const errPct = ((est.price - truePrice) / truePrice) * 100;

console.log(`\n대상: ${TARGET_APT} 전용 ${TARGET_AREA}㎡ ${TARGET_FLOOR}층`);
console.log(`  진짜 가격   ${Math.round(truePrice).toLocaleString('ko-KR')}만원`);
console.log(`  예상 실거래가 ${est.price.toLocaleString('ko-KR')}만원  (오차 ${errPct >= 0 ? '+' : ''}${errPct.toFixed(2)}%)`);
console.log(`  80% 구간    ${est.low.toLocaleString('ko-KR')} ~ ${est.high.toLocaleString('ko-KR')}만원`);
console.log(`  방식 ${est.method} · 유효표본 ${est.sampleSize} · 신뢰도 ${est.confidence}`);
console.log(`  지역 1년 ${est.regionYoyPct}% · 단지 1년 ${est.complexYoyPct}%`);

if (Math.abs(errPct) > 4) fail(`예상가 오차가 4%를 넘었습니다 (${errPct.toFixed(2)}%).`);
if (!(est.low < truePrice && truePrice < est.high)) {
  fail('80% 구간이 진짜 가격을 담지 못했습니다.');
}
if (est.method !== 'hedonic') fail(`표본이 충분한데 ${est.method} 로 강등되었습니다.`);

// ── 3. 표본이 극히 적을 때도 무너지지 않는가 ──
const sparse = complexTrades
  .filter((t) => Math.abs(t.area - TARGET_AREA) < 1)
  .slice(-2);
const sparseEst = estimate({
  regionTrades: trades,
  complexTrades: sparse,
  index,
  area: TARGET_AREA,
  floor: TARGET_FLOOR,
});
if (!sparseEst) fail('거래 2건일 때 계산이 실패했습니다.');
const sparseErr = ((sparseEst.price - truePrice) / truePrice) * 100;
console.log(
  `\n거래 2건만 있을 때: ${sparseEst.price.toLocaleString('ko-KR')}만원 ` +
    `(오차 ${sparseErr >= 0 ? '+' : ''}${sparseErr.toFixed(2)}%) · ${sparseEst.method} · 신뢰도 ${sparseEst.confidence}`,
);
if (Math.abs(sparseErr) > 12) fail(`표본 2건 오차가 12%를 넘었습니다 (${sparseErr.toFixed(2)}%).`);
if (sparseEst.confidence === 'high') fail('표본 2건인데 신뢰도가 높음으로 나왔습니다.');
const widerBand =
  (sparseEst.high - sparseEst.low) / sparseEst.price > (est.high - est.low) / est.price;
if (!widerBand) fail('표본이 적은데 예측구간이 넓어지지 않았습니다.');

// ── 4. 매물 호가 대조 ──
const eok = (v: number) => Math.round((v / 10000) * 10) / 10;
const askLines = [
  `${eok(truePrice * 0.9)}억 12층`, // 확실히 구간 아래
  `${eok(truePrice)}억 12층`, // 추정치 근처
  `${eok(truePrice * 1.25)}억 12층`, // 확실히 구간 위
].join('\n');

const cmp = compareListings({
  regionTrades: trades,
  complexTrades,
  index,
  defaultArea: TARGET_AREA,
  listings: parseListings(askLines),
});

console.log(`\n매물 호가 대조 (${cmp.items.length}건, 읽지 못한 줄 ${cmp.invalid.length}개)`);
for (const it of cmp.items) {
  console.log(
    `  ${it.price.toLocaleString('ko-KR')}만원 → 추정 ${it.estimated.toLocaleString('ko-KR')} · ` +
      `차이 ${it.gapPct >= 0 ? '+' : ''}${it.gapPct}% · ${it.position} · 백분위 ${it.percentile}%`,
  );
}

if (cmp.items.length !== 3) fail(`호가 3건을 읽어야 하는데 ${cmp.items.length}건입니다.`);
if (cmp.invalid.length !== 0) fail('정상 호가인데 읽지 못한 줄이 있습니다.');
if (cmp.items[0].position !== 'below') fail('추정가 -10% 호가가 below 로 분류되지 않았습니다.');
if (cmp.items[1].position !== 'inside') fail('추정가 수준 호가가 inside 로 분류되지 않았습니다.');
if (cmp.items[2].position !== 'above') fail('추정가 +25% 호가가 above 로 분류되지 않았습니다.');
if (
  !(cmp.items[0].percentile < cmp.items[1].percentile &&
    cmp.items[1].percentile < cmp.items[2].percentile)
) {
  fail('백분위가 호가 순서대로 증가하지 않았습니다.');
}
if (!cmp.summary) fail('요약이 비어 있습니다.');
if (cmp.summary.belowCount !== 1 || cmp.summary.insideCount !== 1 || cmp.summary.aboveCount !== 1) {
  fail('요약의 위치별 집계가 맞지 않습니다.');
}

// 층이 저/중/고 로만 적힌 매물은 실제 거래된 층 분포로 환산되어야 한다
const hinted = compareListings({
  regionTrades: trades,
  complexTrades,
  index,
  defaultArea: TARGET_AREA,
  listings: parseListings(`${eok(truePrice)}억 고층`),
});
if (hinted.items.length !== 1) fail('층 힌트 매물을 읽지 못했습니다.');
if (!hinted.items[0].floorAssumed || hinted.items[0].floor == null) {
  fail('고층 힌트가 실제 층수로 환산되지 않았습니다.');
}
console.log(
  `  층 힌트: 고층 → ${hinted.items[0].floor}층으로 환산 (추정 ${hinted.items[0].estimated.toLocaleString('ko-KR')}만원)`,
);

// 시세와 동떨어진 금액은 결과가 아니라 입력 오류로 돌려야 한다
const broken = compareListings({
  regionTrades: trades,
  complexTrades,
  index,
  defaultArea: TARGET_AREA,
  listings: parseListings('5000 12층'),
});
if (broken.items.length !== 0 || broken.invalid.length !== 1) {
  fail('잘못 읽은 금액(5,000만원)이 정상 결과로 통과했습니다.');
}
console.log(`  오파싱 가드: ${broken.invalid[0].error}`);

console.log('\n✓ 모든 검증 통과');

/**
 * 유사 단지 추천 로직 검증 — DB·API 없이 순수 함수만 본다.
 *
 *   npm run similar:check
 */
import { findSimilar, type CandidateTrade } from '../src/lib/similar';
import { PYEONG } from '../src/lib/stats';

let failed = 0;
const check = (ok: boolean, name: string, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const t = (
  aptSeq: string,
  aptNm: string,
  lawdCd: string,
  area: number,
  amount: number,
  dealDate: string,
): CandidateTrade => ({
  lawdCd,
  aptSeq,
  aptNm,
  umdNm: '테스트동',
  buildYear: 2010,
  area,
  floor: 10,
  amount,
  dealDate,
});

const BASE_AREA = 84.5;
const BASE_PRICE = 100_000;

// ── 기본: 기준가에 가까운 순으로 정렬 ──
const candidates: CandidateTrade[] = [
  // 정확히 기준가 (거래 3건)
  t('A', '가단지', '11680', 84.5, 99_000, '2026-07-01'),
  t('A', '가단지', '11680', 84.5, 100_000, '2026-08-01'),
  t('A', '가단지', '11680', 84.5, 101_000, '2026-06-01'),
  // 기준가 +10%
  t('B', '나단지', '11650', 84.9, 110_000, '2026-08-05'),
  t('B', '나단지', '11650', 84.9, 110_000, '2026-07-05'),
  // 기준가 -5%
  t('C', '다단지', '11710', 84.0, 95_000, '2026-08-10'),
  t('C', '다단지', '11710', 84.0, 95_000, '2026-05-10'),
  // 거래 1건뿐 → 대표가격을 내지 않는다
  t('D', '라단지', '11440', 84.7, 100_500, '2026-08-02'),
  // 자기 자신 → 제외
  t('SELF', '기준단지', '11680', 84.5, 100_000, '2026-08-01'),
  t('SELF', '기준단지', '11680', 84.5, 100_000, '2026-07-01'),
];

const out = findSimilar({
  candidates,
  area: BASE_AREA,
  price: BASE_PRICE,
  excludeAptSeq: 'SELF',
});

check(out.length === 3, '거래 2건 미만 단지와 자기 자신을 제외', `${out.length}곳`);
check(!out.some((s) => s.aptSeq === 'SELF'), '기준 단지 제외');
check(!out.some((s) => s.aptSeq === 'D'), '거래 1건 단지 제외');
check(out[0]?.aptSeq === 'A', '기준가에 가장 가까운 것이 처음', out[0]?.aptSeq);
check(out[1]?.aptSeq === 'C', '두 번째는 -5% 쪽', out[1]?.aptSeq);
check(out[2]?.aptSeq === 'B', '세 번째는 +10% 쪽', out[2]?.aptSeq);

const a = out.find((s) => s.aptSeq === 'A')!;
check(a.price === 100_000, '대표가격은 중위 거래금액', String(a.price));
check(a.diffPct === 0, '기준가 대비 0%', String(a.diffPct));
check(a.dealCount === 3, '거래 건수 집계', String(a.dealCount));
check(a.lastDealDate === '2026-08-01', '최근 거래일은 가장 최신', a.lastDealDate);
check(
  Math.abs(a.pricePerPyeong - (100_000 / 84.5) * PYEONG) < 0.2,
  '평단가 = 대표가격 ÷ 전용면적',
  String(a.pricePerPyeong),
);

const c = out.find((s) => s.aptSeq === 'C')!;
check(c.diffPct === -5, '-5% 계산', String(c.diffPct));

// ── 같은 단지의 여러 평형은 기준 면적에 가까운 하나만 ──
const multi: CandidateTrade[] = [
  t('M', '멀티단지', '11680', 79.0, 96_000, '2026-08-01'),
  t('M', '멀티단지', '11680', 79.0, 96_000, '2026-07-01'),
  t('M', '멀티단지', '11680', 84.6, 100_000, '2026-08-02'),
  t('M', '멀티단지', '11680', 84.6, 100_000, '2026-07-02'),
];
const multiOut = findSimilar({
  candidates: multi,
  area: BASE_AREA,
  price: BASE_PRICE,
  excludeAptSeq: 'X',
});
check(multiOut.length === 1, '같은 단지는 한 번만 등장', `${multiOut.length}곳`);
check(multiOut[0]?.area === 84.6, '기준 면적에 가까운 평형을 고름', String(multiOut[0]?.area));

// ── limit ──
const many: CandidateTrade[] = [];
for (let i = 0; i < 30; i++) {
  const code = `Z${i}`;
  many.push(t(code, `단지${i}`, '11680', 84.5, 100_000 + i * 100, '2026-08-01'));
  many.push(t(code, `단지${i}`, '11680', 84.5, 100_000 + i * 100, '2026-07-01'));
}
const limited = findSimilar({
  candidates: many,
  area: BASE_AREA,
  price: BASE_PRICE,
  excludeAptSeq: 'X',
  limit: 5,
});
check(limited.length === 5, 'limit 적용', `${limited.length}곳`);
check(
  limited.every((s, i) => i === 0 || Math.abs(s.diffPct) >= Math.abs(limited[i - 1].diffPct)),
  '차이 절대값 오름차순',
);

// ── 빈 입력 ──
const empty = findSimilar({ candidates: [], area: BASE_AREA, price: BASE_PRICE, excludeAptSeq: 'X' });
check(empty.length === 0, '후보가 없으면 빈 배열');

console.log(failed === 0 ? '\n유사 단지 추천 로직 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

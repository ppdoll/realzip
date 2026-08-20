/**
 * 매물 호가 파서 검증 — API 키 없이 돌아간다.
 *
 *   npm run parse:check
 *
 * 네이버부동산 등에서 복사해 붙이는 형태가 워낙 다양해서, 실제로 마주칠 표기를
 * 표로 고정해 두고 회귀를 잡는다.
 */
import { parseListings } from '../src/lib/compare';
import { PYEONG } from '../src/lib/stats';

type Case = {
  input: string;
  price: number | null;
  floor?: number | null;
  floorHint?: 'low' | 'mid' | 'high' | null;
  /** 전용면적 m² (소수 1자리까지 비교) */
  area?: number | null;
};

const CASES: Case[] = [
  // ── 금액 표기 ──
  { input: '18억', price: 180_000 },
  { input: '18억 5,000', price: 185_000 },
  { input: '18억5000', price: 185_000 },
  { input: '18억5천', price: 185_000 },
  { input: '18억 5천만', price: 185_000 },
  { input: '18.5억', price: 185_000 },
  { input: '9억8000만원', price: 98_000 },
  { input: '185,000', price: 185_000 },
  { input: '185000', price: 185_000 },
  { input: '5억', price: 50_000 },
  { input: '120억', price: 1_200_000 },

  // ── 층 표기 ──
  { input: '18억 12층', price: 180_000, floor: 12 },
  { input: '12/15층 18억', price: 180_000, floor: 12 },
  { input: '18억 중/15층', price: 180_000, floor: null, floorHint: 'mid' },
  { input: '18억 저층', price: 180_000, floor: null, floorHint: 'low' },
  { input: '고층 18억5000', price: 185_000, floor: null, floorHint: 'high' },
  { input: '18억 1층', price: 180_000, floor: 1 },

  // ── 면적 표기 ──
  { input: '84.97㎡ 12층 18억', price: 180_000, floor: 12, area: 84.97 },
  { input: '109.42/84.97㎡ 12/15층 18억5000', price: 185_000, floor: 12, area: 84.97 },
  { input: '84.97m2 18억', price: 180_000, area: 84.97 },
  { input: '34평 12층 18억', price: 180_000, floor: 12, area: 34 * PYEONG },
  { input: '45/34평 18억', price: 180_000, area: 34 * PYEONG },

  // ── 실제로 붙여넣을 만한 잡음 섞인 줄 ──
  { input: '래미안 101동 109.42/84.97㎡ 12/15층 18억 5,000 확인매물', price: 185_000, floor: 12, area: 84.97 },
  { input: '  매매 18억 5000  중층  ', price: 185_000, floor: null, floorHint: 'mid' },

  // ── 거부해야 하는 줄 ──
  { input: '전세 8억', price: null },
  { input: '월세 1000/50', price: null },
  { input: '가격문의', price: null },
  { input: '12층', price: null },
];

let failed = 0;
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

for (const c of CASES) {
  const [got] = parseListings(c.input);
  const problems: string[] = [];

  if (c.price == null) {
    if (got && got.price != null) problems.push(`거부해야 하는데 ${got.price} 로 읽음`);
  } else {
    if (!got) problems.push('아무것도 읽지 못함');
    else {
      if (got.price !== c.price) problems.push(`금액 ${got.price} ≠ ${c.price}`);
      if (c.floor !== undefined && got.floor !== c.floor) {
        problems.push(`층 ${got.floor} ≠ ${c.floor}`);
      }
      if (c.floorHint !== undefined && got.floorHint !== c.floorHint) {
        problems.push(`층힌트 ${got.floorHint} ≠ ${c.floorHint}`);
      }
      if (c.area !== undefined) {
        const a = got.area == null ? null : Math.round(got.area * 10) / 10;
        const want = c.area == null ? null : Math.round(c.area * 10) / 10;
        if (a !== want) problems.push(`면적 ${a} ≠ ${want}`);
      }
    }
  }

  if (problems.length > 0) {
    failed++;
    console.log(`✗ ${pad(JSON.stringify(c.input), 62)} ${problems.join(' · ')}`);
  } else {
    console.log(`✓ ${pad(JSON.stringify(c.input), 62)} ${got?.price ?? '거부'}`);
  }
}

// 여러 줄 한꺼번에
const multi = parseListings(`
18억 5000 12층
17억 8000 3층

전세 9억
19억 고층
`);
const validCount = multi.filter((m) => m.price != null).length;
const rejectCount = multi.filter((m) => m.price == null).length;
if (validCount !== 3 || rejectCount !== 1) {
  failed++;
  console.log(`✗ 여러 줄 입력 — 유효 ${validCount}(기대 3) / 거부 ${rejectCount}(기대 1)`);
} else {
  console.log(`✓ 여러 줄 입력 — 유효 3 / 거부 1`);
}

console.log(failed === 0 ? '\n파서 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

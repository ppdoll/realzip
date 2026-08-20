/**
 * 단지 정보 로직 검증 — API·DB 없이 순수 함수만 본다.
 *
 *   npm run facts:check
 *
 * 조인 키를 뽑는 주소 파싱과, 세대수로 나누는 지표 계산을 고정한다.
 */
import { parseAddr } from '../src/lib/kapt';
import { kaptMatcher, matchKapt } from '../src/lib/kapt-match';
import { buildComplexFacts, turnoverLabel } from '../src/lib/complex-facts';
import type { KaptRow } from '../src/lib/store-kapt';

let failed = 0;
const check = (ok: boolean, name: string, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

// ── 주소 → 법정동 + 지번 (실거래가와 조인하는 유일한 키) ──
const ADDR_CASES: [string, string | null, string | null][] = [
  ['서울특별시 강남구 대치동 316 은마', '대치동', '316'],
  ['서울특별시 강남구 삼성동 16-2 삼성동힐스테이트 1단지', '삼성동', '16-2'],
  ['경기도 화성시 반송동 90 시범다은마을삼성래미안', '반송동', '90'],
  ['경기도 성남시 분당구 구미동 175 까치마을', '구미동', '175'],
  ['서울특별시 종로구 무악동 60 무악현대', '무악동', '60'],
  ['경기도 남양주시 와부읍 덕소리 400 한강우성', '덕소리', '400'],
  ['서울특별시 중구 신당동 366-1 남산타운', '신당동', '366-1'],
  ['주소 없음', null, null],
];
for (const [addr, umd, jibun] of ADDR_CASES) {
  const got = parseAddr(addr);
  check(
    got.umdNm === umd && got.jibun === jibun,
    `주소 파싱 ${JSON.stringify(addr.slice(0, 34))}`,
    `${got.umdNm} / ${got.jibun}`,
  );
}
check(parseAddr(null).jibun === null, 'null 주소 처리');

// ── 지표 계산 ──
const base: KaptRow = {
  kaptCode: 'A1',
  lawdCd: '11680',
  umdNm: '대치동',
  jibun: '316',
  kaptName: '은마',
  addr: '서울특별시 강남구 대치동 316 은마',
  roadAddr: '서울특별시 강남구 삼성로 212',
  households: 4424,
  dongCnt: 28,
  totalArea: 504698,
  privArea: 353088.96,
  useDate: '19790830',
  heatNm: '지역난방',
  hallNm: '복도식',
  mgrNm: '위탁관리',
  saleNm: '분양',
  builder: '한보',
  topFloor: 14,
  elevatorCnt: 42,
};

const f = buildComplexFacts({ kapt: base, saleCount12m: 38, rentCount12m: 926 });
check(f.turnoverPct === 0.9, '회전율 = 매매÷세대수', String(f.turnoverPct));
check(f.rentReportPct === 20.9, '전월세 신고율', String(f.rentReportPct));
check(f.privRatioPct === 70, '전용률 = 전용÷연면적', String(f.privRatioPct));
check(f.areaPerHousehold === 79.8, '세대 평균 전용', String(f.areaPerHousehold));
check(f.pyeongPerHousehold === 24, '평 환산', String(f.pyeongPerHousehold));
check(f.approvedAt === '1979-08-30', '사용승인일 형식', String(f.approvedAt));

// 세대수가 없으면 나눗셈 지표는 계산하지 않는다 (0으로 나누거나 엉뚱한 값을 내면 안 된다)
const noH = buildComplexFacts({
  kapt: { ...base, households: null },
  saleCount12m: 38,
  rentCount12m: 926,
});
check(noH.turnoverPct === null, '세대수 없으면 회전율 null');
check(noH.rentReportPct === null, '세대수 없으면 신고율 null');
check(noH.areaPerHousehold === null, '세대수 없으면 세대평균 null');
check(noH.privRatioPct === 70, '전용률은 세대수와 무관하게 계산');

const zeroH = buildComplexFacts({
  kapt: { ...base, households: 0 },
  saleCount12m: 10,
  rentCount12m: 10,
});
check(zeroH.turnoverPct === null, '세대수 0 도 null (0으로 나누지 않는다)');

const noArea = buildComplexFacts({
  kapt: { ...base, totalArea: null, privArea: null },
  saleCount12m: 0,
  rentCount12m: 0,
});
check(noArea.privRatioPct === null && noArea.areaPerHousehold === null, '면적 없으면 null');
check(noArea.turnoverPct === 0, '거래 0건이면 회전율 0');

check(buildComplexFacts({ kapt: { ...base, useDate: '1979' }, saleCount12m: 0, rentCount12m: 0 })
  .approvedAt === null, '잘못된 승인일은 null');

// ── 회전율 라벨 ──
check(turnoverLabel(0.9) === '손바뀜 적음', '라벨 0.9%', String(turnoverLabel(0.9)));
check(turnoverLabel(2.2) === '보통', '라벨 2.2%', String(turnoverLabel(2.2)));
check(turnoverLabel(4.5) === '활발', '라벨 4.5%', String(turnoverLabel(4.5)));
check(turnoverLabel(6.5) === '매우 활발', '라벨 6.5%', String(turnoverLabel(6.5)));
check(turnoverLabel(null) === null, '라벨 null 처리');

// -- 실거래 <-> 단지정보 매칭 (상세 카드와 구 분포가 같이 쓰는 규칙) --
const POOL = [
  { umdNm: '대치동', jibun: '316', kaptName: '은마아파트' },
  { umdNm: '대치동', jibun: '670', kaptName: '래미안대치팰리스1단지' },
  { umdNm: '대치동', jibun: '671', kaptName: '래미안대치팰리스2단지' },
  { umdNm: '역삼동', jibun: '758', kaptName: '역삼래미안' },
  { umdNm: '구미동', jibun: '175', kaptName: '까치마을1단지' },
  { umdNm: '구미동', jibun: '176', kaptName: '까치마을2단지' },
  { umdNm: '삼성동', jibun: '42', kaptName: 'AID차관' },
  { umdNm: '삼성동', jibun: '42', kaptName: '삼성동중앙하이츠' },
];
const m = (umdNm: string | null, jibun: string | null, aptNm: string) =>
  matchKapt(POOL, { umdNm, jibun, aptNm })?.kaptName ?? null;

check(m('대치동', '316', '은마') === '은마아파트', '지번 일치가 우선', String(m('대치동', '316', '은마')));
// 실제로 이렇게 빠졌던 케이스 — 지번이 어긋나면 같은 동 안에서 이름으로 붙여야 한다
check(
  m('대치동', '999', '래미안대치팰리스1단지') === '래미안대치팰리스1단지',
  '지번 어긋나도 같은 동 이름으로 보정',
  String(m('대치동', '999', '래미안대치팰리스1단지')),
);
check(m('구미동', null, '까치마을 1단지') === '까치마을1단지', '공백 무시하고 단지번호 일치');
check(m('구미동', null, '까치마을 2단지') === '까치마을2단지', '1단지와 2단지를 섞지 않는다');
check(m('구미동', null, '까치마을') === null, '단지번호 없으면 후보 2개 -> 포기');
check(m('삼성동', '42', '삼성동중앙하이츠') === '삼성동중앙하이츠', '같은 지번 2개는 이름으로 가린다');
check(m('삼성동', '42', '없는이름') === null, '같은 지번인데 이름으로도 못 가리면 포기');
check(m('청담동', '1', '은마') === null, '다른 법정동은 이름이 같아도 안 붙인다');
check(m(null, null, '은마') === null, '법정동이 없으면 못 찾는다');
check(matchKapt([], { umdNm: '대치동', jibun: '316', aptNm: '은마' }) === null, '후보 0개 처리');

// 색인판은 단건 매칭과 같은 답을 내야 한다 (구 분포가 수백 번 물어보는 경로)
const fast = kaptMatcher(POOL);
const SAME: [string | null, string | null, string][] = [
  ['대치동', '316', '은마'],
  ['대치동', '999', '래미안대치팰리스1단지'],
  ['구미동', null, '까치마을'],
  ['삼성동', '42', '삼성동중앙하이츠'],
  ['청담동', '1', '은마'],
];
check(
  SAME.every(
    ([u, j, a]) =>
      (fast({ umdNm: u, jibun: j, aptNm: a })?.kaptName ?? null) ===
      (matchKapt(POOL, { umdNm: u, jibun: j, aptNm: a })?.kaptName ?? null),
  ),
  '색인판과 단건 매칭 결과가 같다',
);

console.log(failed === 0 ? '\n단지 정보 로직 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

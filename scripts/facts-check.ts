/**
 * 단지 정보 로직 검증 — API·DB 없이 순수 함수만 본다.
 *
 *   npm run facts:check
 *
 * 조인 키를 뽑는 주소 파싱과, 세대수로 나누는 지표 계산을 고정한다.
 */
import { parseAddr } from '../src/lib/kapt';
import { areaClusterer, roomsHint } from '../src/lib/area-bands';
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

// 실거래는 한 단지를 블록으로 쪼개 보내고(고층/저층) K-apt 는 "단지" 를 붙인다.
// 게다가 K-apt 는 15·16단지를 같은 지번(상계동 624)에 올려 놔서 지번으로 못 가린다.
// 실측으로 상계주공16 이 이 두 가지가 겹쳐 매칭에서 빠져 있었다.
const SANGGYE = [
  { umdNm: '상계동', jibun: '624', kaptName: '상계주공15단지' },
  { umdNm: '상계동', jibun: '624', kaptName: '상계주공16단지' },
  { umdNm: '상계동', jibun: '765', kaptName: '상계주공1단지' },
];
const sg = (aptNm: string, jibun: string | null = '624') =>
  matchKapt(SANGGYE, { umdNm: '상계동', jibun, aptNm })?.kaptName ?? null;

check(sg('상계주공16(고층)') === '상계주공16단지', '지번 충돌 + 고층/단지 표기차', String(sg('상계주공16(고층)')));
check(sg('상계주공15(고층)') === '상계주공15단지', '같은 지번의 다른 번호는 번호로 가린다');
check(sg('상계주공17(고층)') === null, '없는 번호는 억지로 붙이지 않는다');
// 같은 단지의 두 블록은 같은 K-apt 로 가야 한다 (회전율을 합쳐 세려면 필수)
check(
  sg('상계주공1(고층)', '765') === '상계주공1단지' && sg('상계주공1(저층)', '765') === '상계주공1단지',
  '고층·저층 블록이 같은 단지로 붙는다',
);
// 군더더기를 떼도 번호는 지켜야 한다
check(
  matchKapt(
    [{ umdNm: '중계동', jibun: '1', kaptName: '중계무지개아파트' }],
    { umdNm: '중계동', jibun: '1', aptNm: '중계무지개' },
  )?.kaptName === '중계무지개아파트',
  '아파트 접미사 무시',
);
check(sg('상계주공1(고층)') === null, '지번이 다르면 번호가 맞아도 안 붙인다 (624 vs 765)');

// 아래는 모두 강남·노원 실제 데이터에서 뽑은 것이다.
// 실거래 단지명에는 동 번호·지번이 딸려 오고(현대8차(성수현대:91~95동)) K-apt 는
// 지구 코드를 붙이거나(월계6-2초안) 차수 표기가 다르다(중계현대2차(4동)).
// 숫자가 "같아야 한다" 로 판단하면 이런 정상 조인을 19건 중 16건 잃었다.
// 지금은 **하나라도 겹치면 통과** 이고, 하나도 안 겹칠 때만 다른 단지로 본다.
const REAL: [string, { umdNm: string; jibun: string | null; kaptName: string }[], string, string, string | null][] = [
  ['한양5 ↔ 압구정한양3단지', [{ umdNm: '압구정동', jibun: '513', kaptName: '압구정한양3단지' }], '513', '한양5', null],
  ['한양6 ↔ 압구정한양제2단지', [{ umdNm: '압구정동', jibun: '484', kaptName: '압구정한양아파트제2단지' }], '484', '한양6', null],
  ['현대8차(동번호 딸림)', [{ umdNm: '압구정동', jibun: '481', kaptName: '압구정현대8차' }], '481', '현대8차(성수현대:91~95동)', '압구정현대8차'],
  ['청암3단지(지번 딸림)', [{ umdNm: '중계동', jibun: '582', kaptName: '중계청암3단지' }], '582', '청암3단지(582)', '중계청암3단지'],
  ['초안2 ↔ 월계6-2초안', [{ umdNm: '월계동', jibun: '924', kaptName: '월계6-2초안' }], '924', '초안2', '월계6-2초안'],
  ['초안1 ↔ 월계6-1초안', [{ umdNm: '월계동', jibun: '923', kaptName: '월계6-1초안' }], '923', '초안1', '월계6-1초안'],
  ['초안2 ↔ 월계6-1초안 (다른 단지)', [{ umdNm: '월계동', jibun: '923', kaptName: '월계6-1초안' }], '923', '초안2', null],
  ['래미안삼성1차 괄호 지번', [{ umdNm: '삼성동', jibun: '105', kaptName: '래미안삼성1차(105)' }], '105', '래미안삼성1차(105-0)', '래미안삼성1차(105)'],
  ['중계현대2 ↔ 2차(4동)', [{ umdNm: '중계동', jibun: '435-1', kaptName: '중계현대2차(4동)' }], '435-1', '중계현대2', '중계현대2차(4동)'],
  ['이름이 아예 다른 것도 지번으로', [{ umdNm: '백현동', jibun: '1', kaptName: '더샵판교퍼스트파크' }], '1', 'THESHARP판교퍼스트파크', '더샵판교퍼스트파크'],
];
for (const [name, pool, jibun, aptNm, want] of REAL) {
  const got = matchKapt(pool, { umdNm: pool[0].umdNm, jibun, aptNm })?.kaptName ?? null;
  check(got === want, `실측 ${name}`, got ?? 'null');
}

// 같은 지번에 후보가 여럿일 때 — 예전에는 DB 가 준 순서대로 첫 번째를 집었고,
// 그래서 틀린 값이 그럴듯하게 나왔다. 63개 구 감사에서 잡힌 실제 사례들이다.
// K-apt 는 한 단지를 임대/분양으로 나눠 올리고(신당남산타운임대 / (분양)),
// 동 단위로 따로 올리고(왕십리텐즈힐2구역214동), 접두어를 붙인다(SH황학...).
// 매매는 분양 세대에서 일어나므로 임대 등록을 분모로 쓰면 회전율이 부풀려진다.
const PICK: [string, [string, number][], string, string | null][] = [
  ['텐즈힐(1단지) — 임대 등록 회피', [['왕십리텐즈힐1단지(임대)', 333], ['텐즈힐1단지', 1369]], '텐즈힐(1단지)', '텐즈힐1단지'],
  ['텐즈힐(2단지) — 214동 등록 회피', [['왕십리텐즈힐2구역214동', 211], ['텐즈힐2구역', 937]], '텐즈힐(2단지)', '텐즈힐2구역'],
  ['롯데캐슬 — SH 접두어 회피', [['SH황학롯데캐슬베네치아', 336], ['롯데캐슬베네치아', 1534]], '롯데캐슬', '롯데캐슬베네치아'],
  ['남산타운 — 분양 쪽', [['신당남산타운임대', 2034], ['신당남산타운(분양)', 3118]], '남산타운', '신당남산타운(분양)'],
  ['약수하이츠 — 분양 쪽', [['약수하이츠아파트(임대)', 684], ['신당약수하이츠', 1598]], '약수하이츠', '신당약수하이츠'],
  ['개포주공7단지 — 번호로', [['개포주공7단지', 900], ['개포주공6단지', 1060]], '개포주공7단지', '개포주공7단지'],
  ['천왕이펜하우스3단지 — 번호로', [['천왕이펜하우스5단지', 522], ['천왕이펜하우스3단지', 1044]], '천왕이펜하우스3단지', '천왕이펜하우스3단지'],
  // 근거가 얇으면 포기해야 한다 — 틀린 값을 보여주는 것보다 값이 없는 게 낫다
  ['수서 — 1자 차이로는 못 가린다', [['일원동 수서아파트', 720], ['수서1-1단지아파트', 2214]], '수서', null],
  ['까치마을 — 번호가 없으면 못 가린다', [['까치마을1단지', 500], ['까치마을2단지', 500]], '까치마을', null],
];
for (const [name, pool, aptNm, want] of PICK) {
  const cands = pool.map(([kaptName]) => ({ umdNm: '동', jibun: '1', kaptName }));
  const got = matchKapt(cands, { umdNm: '동', jibun: '1', aptNm })?.kaptName ?? null;
  check(got === want, `후보 여럿 ${name}`, got ?? 'null');
}

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

// -- 면적 묶음 --
// 정수 ㎡ 로 반올림하면 경계에 걸린 같은 타입이 갈린다. 실제로 겪은 값들이다:
//   하이파크시티일산파밀리에2단지 121.45㎡(20건) / 121.66㎡(10건) -> 화면에 같은 36.8평 두 줄
//   84.44 / 84.57 -> 84 와 85 로 갈려 매매·전세 짝이 안 맞음
{
  const c = areaClusterer([121.45, 121.66, 146.51, 173.77, 84.44, 84.57]);
  check(c(121.45) === c(121.66), '121.45 와 121.66 은 같은 묶음', `${c(121.45)} / ${c(121.66)}`);
  check(c(84.44) === c(84.57), '84.44 와 84.57 은 같은 묶음');
  check(c(84.44) !== c(121.45), '84㎡ 와 121㎡ 는 다른 묶음');
  check(c(146.51) !== c(173.77), '146㎡ 와 173㎡ 는 다른 묶음');
  // 매매에만 있는 면적을 전세 쪽에서 물어봐도 같은 묶음이어야 짝이 맞는다
  check(c(84.5) === c(84.44), '목록에 없는 84.5 도 가까운 묶음에 붙는다', String(c(84.5)));
  check(c(200) === -1, '어느 묶음과도 멀면 -1');
  // 간격 기준을 넘으면 갈라야 한다
  const d = areaClusterer([59.9, 61.6]);
  check(d(59.9) !== d(61.6), '1.7㎡ 차이는 갈린다', `${d(59.9)} / ${d(61.6)}`);
}
{
  // 정확히 기준(1.5㎡)인 경우 — 초과일 때만 갈라야 한다
  const c = areaClusterer([80, 81.5, 83.1]);
  check(c(80) === c(81.5), '정확히 1.5㎡ 차이는 같은 묶음');
  check(c(81.5) !== c(83.1), '1.6㎡ 차이는 갈린다 (기준 초과)', `${c(81.5)} / ${c(83.1)}`);
}
check(areaClusterer([]) (84) === -1, '빈 목록이면 -1');

// -- 방 수 참고 표기 (데이터가 아니라 통념이라는 점을 고정한다) --
// 구간은 전용면적 기준이다. 평으로 자르면 전용 84㎡(25.4평)가 20평대로 떨어지고
// 전용 59㎡(17.9평, 흔히 24평형이라 부르는 표준 3룸)가 "원룸~2룸" 이 된다 — 실제로 겪었다.
check(roomsHint(84.9) === '보통 3룸', '전용 84.9㎡ 는 보통 3룸 (60~85 구간)', String(roomsHint(84.9)));
check(roomsHint(59.9) === '보통 2~3룸', '전용 59.9㎡ 는 40~60 구간', String(roomsHint(59.9)));
// 법령 기준은 "60㎡ 이하" / "60 초과 85 이하" / "85 초과" 다. 경계값이 아래 구간에 든다.
check(roomsHint(60) === '보통 2~3룸', '전용 60.0㎡ 은 40~60 구간 (60 이하)', String(roomsHint(60)));
check(roomsHint(60.1) === '보통 3룸', '전용 60.1㎡ 은 60~85 구간', String(roomsHint(60.1)));
check(roomsHint(85) === '보통 3룸', '전용 85.0㎡ 은 국민주택 규모 (85 이하)', String(roomsHint(85)));
check(roomsHint(85.1) === '보통 3~4룸', '전용 85.1㎡ 은 85 초과', String(roomsHint(85.1)));
check(roomsHint(0) === null, '면적 0 은 구간 없음');
check(roomsHint(24) === '원룸~2룸', '전용 24㎡ 는 원룸~2룸', String(roomsHint(24)));
check(roomsHint(114) === '보통 3~4룸', '전용 114㎡ 는 85~135 구간', String(roomsHint(114)));
check(roomsHint(140) === '4룸 이상', '전용 140㎡ 는 135 초과', String(roomsHint(140)));

console.log(failed === 0 ? '\n단지 정보 로직 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

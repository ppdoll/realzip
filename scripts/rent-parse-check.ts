/**
 * 전월세 파서 검증 — API 키/활용신청 없이 돌아간다.
 *
 *   npm run rent:check
 *
 * 전월세 자료는 매매와 별도로 활용신청해야 해서, 신청 전에는 실제 응답을 볼 수 없다.
 * 그래서 공식 문서의 태그명과 프록시로 확인한 실제 값(강남구 2026-05)으로 XML 픽스처를
 * 만들어 파서를 검증한다. 특히 다음 두 함정을 고정해 둔다.
 *
 *   · 전용면적 태그가 매매는 excluUseAr, 전월세는 **exclUseAr** (u 하나 차이)
 *   · 전월세에는 **aptSeq 가 없다** → 단지 매칭은 법정동+단지명+지번
 */
import { XMLParser } from 'fast-xml-parser';
import { normalizeRent } from '../src/lib/molit-rent';
import { filterComplexRents, jeonseAsTrades, summarizeRent } from '../src/lib/rent';
import { buildRegionIndex, estimate } from '../src/lib/estimate';
import { recentMonths } from '../src/lib/months';
import type { Rent } from '../src/lib/types';

const MONTHS = recentMonths(36);
const LAST = MONTHS[MONTHS.length - 1];

/** 실제 응답 형태 — 값은 프록시로 확인한 강남구 2026-05 데이터 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
  <body>
    <items>
      <item>
        <aptNm>은마</aptNm>
        <buildYear>1979</buildYear>
        <contractTerm>26.05~28.05</contractTerm>
        <contractType>신규</contractType>
        <dealDay>5</dealDay>
        <dealMonth>5</dealMonth>
        <dealYear>2026</dealYear>
        <deposit>20,000</deposit>
        <exclUseAr>84.43</exclUseAr>
        <floor>10</floor>
        <jibun>316</jibun>
        <monthlyRent>300</monthlyRent>
        <preDeposit>18,000</preDeposit>
        <preMonthlyRent>250</preMonthlyRent>
        <sggCd>11680</sggCd>
        <umdNm>대치동</umdNm>
        <useRRRight>사용</useRRRight>
      </item>
      <item>
        <aptNm>아크로힐스논현</aptNm>
        <buildYear>2014</buildYear>
        <contractTerm>26.05~28.05</contractTerm>
        <contractType></contractType>
        <dealDay>13</dealDay>
        <dealMonth>5</dealMonth>
        <dealYear>2026</dealYear>
        <deposit>175,000</deposit>
        <exclUseAr>113.231</exclUseAr>
        <floor>5</floor>
        <jibun>1</jibun>
        <monthlyRent>0</monthlyRent>
        <preDeposit></preDeposit>
        <preMonthlyRent></preMonthlyRent>
        <sggCd>11680</sggCd>
        <umdNm>논현동</umdNm>
        <useRRRight></useRRRight>
      </item>
    </items>
    <numOfRows>1000</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>2</totalCount>
  </body>
</response>`;

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, parseTagValue: false });

let failed = 0;
const check = (ok: boolean, name: string, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

// ── 1) XML 파싱 ──
const doc = parser.parse(XML) as Record<string, any>;
const items = doc.response.body.items.item as Record<string, unknown>[];
const parsed = items.map((it) => normalizeRent(it, '11680')).filter((r): r is Rent => r !== null);

check(parsed.length === 2, '2건 파싱', `${parsed.length}건`);

const [eunma, acro] = parsed;
check(eunma?.aptNm === '은마', '단지명', eunma?.aptNm);
check(eunma?.area === 84.43, 'exclUseAr 를 전용면적으로 읽음', String(eunma?.area));
check(eunma?.deposit === 20_000, '보증금 콤마 제거', String(eunma?.deposit));
check(eunma?.monthlyRent === 300, '월세', String(eunma?.monthlyRent));
check(eunma?.dealDate === '2026-05-05', '계약일 조립', eunma?.dealDate);
check(eunma?.dealYm === '202605', '계약년월', eunma?.dealYm);
check(eunma?.jibun === '316', '지번', String(eunma?.jibun));
check(eunma?.contractType === '신규', '계약구분', String(eunma?.contractType));
check(eunma?.preDeposit === 18_000, '종전 보증금', String(eunma?.preDeposit));
check(eunma?.useRRRight === '사용', '갱신요구권', String(eunma?.useRRRight));
check(acro?.monthlyRent === 0, '월세 0 = 전세', String(acro?.monthlyRent));
check(acro?.deposit === 175_000, '전세 보증금 17.5억', String(acro?.deposit));
check(acro?.preDeposit === null, '빈 태그는 null', String(acro?.preDeposit));
check(acro?.area === 113.231, '소수 3자리 면적 보존', String(acro?.area));

// 매매 철자(excluUseAr)로 와도 읽어야 한다 (구버전/혼용 대비)
const legacySpelling = normalizeRent(
  { aptNm: '테스트', excluUseAr: '59.94', deposit: '50,000', monthlyRent: '0',
    dealYear: '2026', dealMonth: '3', dealDay: '2', umdNm: '어딘가', jibun: '1' },
  '11680',
);
check(legacySpelling?.area === 59.94, 'excluUseAr 철자도 허용', String(legacySpelling?.area));

// 국문 태그(구 API)도 읽어야 한다
const korean = normalizeRent(
  { 아파트: '테스트', 전용면적: '84.97', 보증금액: '60,000', 월세금액: '0',
    년: '2026', 월: '4', 일: '9', 법정동: '어딘가', 지번: '2' },
  '11680',
);
check(korean?.area === 84.97 && korean?.deposit === 60_000, '국문 태그 허용');

// ── 2) 단지 매칭 (aptSeq 가 없으므로 이름 기반) ──
const pool: Rent[] = [
  { ...eunma },
  { ...eunma, jibun: '316', floor: 3, deposit: 21_000, monthlyRent: 0 },
  { ...eunma, umdNm: '대치동', aptNm: '은마', jibun: '999', deposit: 19_000 },
  { ...acro },
];
const matchedExact = filterComplexRents(pool, { umdNm: '대치동', aptNm: '은마', jibun: '316' });
check(matchedExact.length === 2, '지번까지 일치하는 건만 우선 매칭', `${matchedExact.length}건`);

const matchedLoose = filterComplexRents(pool, { umdNm: '대치동', aptNm: '은마', jibun: '000' });
check(matchedLoose.length === 3, '지번이 안 맞으면 법정동+단지명으로 넓힘', `${matchedLoose.length}건`);

const spaced = filterComplexRents(pool, { umdNm: ' 대치동 ', aptNm: '은 마', jibun: '316' });
check(spaced.length === 2, '공백 표기 차이 무시', `${spaced.length}건`);

const none = filterComplexRents(pool, { umdNm: '역삼동', aptNm: '없는단지', jibun: null });
check(none.length === 0, '없는 단지는 0건');

// ── 3) 전세만 추정에 들어가는지 ──
const asTrades = jeonseAsTrades(pool);
check(asTrades.length === 2, '월세 계약은 전세 추정에서 제외', `${asTrades.length}건`);
check(
  asTrades.every((t) => t.amount > 0 && !t.canceled && t.dealingGbn === null),
  '보증금이 amount 로 옮겨짐',
);

// ── 4) 전세 추정 + 전세가율 (합성 데이터로 정합성 확인) ──
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const TRUE_JEONSE_PPM2 = 700; // 만원/m²
const regionRents: Rent[] = [];
for (let c = 0; c < 12; c++) {
  for (const area of [59.94, 84.97]) {
    MONTHS.forEach((ym) => {
      if (rand() > 0.5) return;
      const level = (1 + 0.004) ** MONTHS.indexOf(ym);
      const base = c === 3 ? TRUE_JEONSE_PPM2 : 450 + c * 40;
      regionRents.push({
        lawdCd: '11680',
        umdNm: '대치동',
        aptNm: `단지${c}`,
        jibun: String(c),
        buildYear: 2000,
        area,
        floor: 1 + Math.floor(rand() * 20),
        dealDate: `${ym.slice(0, 4)}-${ym.slice(4, 6)}-10`,
        dealYm: ym,
        deposit: Math.round(base * area * level * (1 + (rand() - 0.5) * 0.05)),
        monthlyRent: 0,
        contractTerm: null,
        contractType: null,
        preDeposit: null,
        preMonthlyRent: null,
        useRRRight: null,
      });
    });
  }
}
const targetRents = filterComplexRents(regionRents, {
  umdNm: '대치동',
  aptNm: '단지3',
  jibun: '3',
});
const salePrice = 200_000;
const summary = summarizeRent({
  regionRents,
  complexRents: targetRents,
  from: MONTHS[0],
  to: LAST,
  area: 84.97,
  floor: 10,
  salePrice,
});

check(summary != null, '요약 생성');
if (summary) {
  const truthNow = TRUE_JEONSE_PPM2 * 84.97 * (1 + 0.004) ** (MONTHS.length - 1);
  const err = summary.jeonsePrice != null ? ((summary.jeonsePrice - truthNow) / truthNow) * 100 : NaN;
  console.log(
    `  전세 추정 ${summary.jeonsePrice?.toLocaleString('ko-KR')}만원 ` +
      `(진짜 ${Math.round(truthNow).toLocaleString('ko-KR')}, 오차 ${err.toFixed(2)}%) · ` +
      `표본 ${summary.jeonseSamples} · 신뢰도 ${summary.jeonseConfidence}`,
  );
  console.log(`  전세가율 ${summary.jeonseRatioPct}% (매매 ${salePrice.toLocaleString('ko-KR')}만원 기준)`);
  check(Math.abs(err) < 5, '전세 추정 오차 5% 이내', `${err.toFixed(2)}%`);
  check(summary.jeonseRatioPct != null, '전세가율 계산됨');
  check(
    summary.jeonseRatioPct ===
      Math.round(((summary.jeonsePrice! / salePrice) * 100) * 10) / 10,
    '전세가율 = 전세추정 ÷ 매매추정',
  );
  check(summary.monthlyCount === 0 && summary.jeonseCount > 0, '전세/월세 건수 분리');
}

// 매매가를 안 넘기면 전세가율은 null 이어야 한다
const noSale = summarizeRent({
  regionRents,
  complexRents: targetRents,
  from: MONTHS[0],
  to: LAST,
  area: 84.97,
});
check(noSale?.jeonseRatioPct === null, '매매가 없으면 전세가율은 null');

// 전세 표본이 없으면 추정 없이도 무너지지 않아야 한다
const monthlyOnly = summarizeRent({
  regionRents,
  complexRents: [{ ...eunma }],
  from: MONTHS[0],
  to: LAST,
  area: 84.43,
  salePrice,
});
check(monthlyOnly != null, '월세만 있어도 요약 생성');
check(monthlyOnly?.jeonsePrice === null, '전세 표본 없으면 추정 null');
check(monthlyOnly?.lastMonthly?.monthlyRent === 300, '최근 월세 정보 유지');

console.log(failed === 0 ? '\n전월세 파서·매칭·추정 검증 통과' : `\n실패 ${failed}건`);
process.exit(failed === 0 ? 0 : 1);

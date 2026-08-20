import type { KaptRow } from './store-kapt';
import { PYEONG } from './stats';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  단지 지표 — 단지 정보(세대수 등) × 내 거래 데이터
 * ────────────────────────────────────────────────────────────────────────
 *
 *  세대수 자체는 여러 사이트가 보여준다. 여기서 만드는 값은 **세대수와 거래 기록을
 *  곱해야 나오는 것들**이다 — 그게 이 앱이 따로 가진 부분이다.
 *
 *   · 거래 회전율   최근 1년 매매 건수 ÷ 세대수. 낮으면 매물이 잠긴 단지,
 *                   높으면 손바뀜이 빠른 단지다. 유동성 감각을 준다.
 *   · 전월세 신고율 최근 1년 전월세 신고 ÷ 세대수. **임대 비중이 아니다** —
 *                   전월세 계약은 보통 2년이라 매년 절반쯤만 갱신 신고되고,
 *                   갱신 신고가 빠지는 경우도 있다. 그래서 "임대 비중"이라고
 *                   쓰지 않고 신고율 그대로 보여주고, 화면에 그 뜻을 적는다.
 *   · 전용률       전용면적 합 ÷ 연면적. 구축이 높고 신축이 낮은 경향이라
 *                   같은 평형이라도 실사용 면적 감각이 다르다.
 *   · 세대 평균 전용 전용면적 합 ÷ 세대수. 대형 위주인지 소형 위주인지.
 */

export type ComplexFacts = {
  kaptCode: string;
  kaptName: string;
  addr: string | null;
  roadAddr: string | null;

  households: number | null;
  dongCnt: number | null;
  topFloor: number | null;
  elevatorCnt: number | null;
  /** 사용승인일 (YYYY-MM-DD) — 거래 데이터의 건축년도보다 정확하다 */
  approvedAt: string | null;
  heatNm: string | null;
  hallNm: string | null;
  mgrNm: string | null;
  saleNm: string | null;
  builder: string | null;

  /** 최근 1년 매매 건수 ÷ 세대수 × 100 */
  turnoverPct: number | null;
  saleCount12m: number;
  /** 최근 1년 전월세 신고 ÷ 세대수 × 100 (임대 비중이 아님) */
  rentReportPct: number | null;
  rentCount12m: number;
  /** 전용면적 합 ÷ 연면적 × 100 */
  privRatioPct: number | null;
  /** 세대 평균 전용면적 (m²) */
  areaPerHousehold: number | null;
  /** 같은 값을 평으로 */
  pyeongPerHousehold: number | null;

  /** 건물 종류 (아파트 / 주상복합 …) */
  aptKind: string | null;
  /**
   * 세대 규모 구성 — 없으면 null.
   *
   * 방 갯수는 어느 공공데이터에도 없다(K-apt·건축물대장·건축도면·청약홈 모두 확인).
   * 대신 이 구성이 단지 성격을 보여준다: 2,100세대가 전부 60㎡ 이하면 소형 단지고,
   * 은마처럼 4,400세대가 85~135㎡ 면 중대형 단지다.
   * 구간은 청약·세금이 쓰는 전용면적 기준(60·85·135㎡)이다.
   */
  unitMix: UnitMix | null;
};

export type UnitMix = {
  /** 전용 60㎡ 이하 / 60~85 / 85~135 / 135 초과 세대수 */
  bands: { label: string; units: number; pct: number }[];
  total: number;
  /** 전 세대가 60㎡ 이하 — 원룸형·소형 단지 신호 */
  allSmall: boolean;
  /** 60㎡ 이하 비중 (%) */
  smallPct: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 19790830 → 1979-08-30 */
function formatUseDate(v: string | null): string | null {
  if (!v || !/^\d{8}$/.test(v)) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export type ComplexFactsInput = {
  kapt: KaptRow;
  /** 이 단지의 최근 12개월 매매 건수 */
  saleCount12m: number;
  /** 이 단지의 최근 12개월 전월세 신고 건수 */
  rentCount12m: number;
};

/**
 * 세대 규모 구성. K-apt 가 네 구간 세대수를 주는데, 합이 세대수와 맞지 않거나
 * 전부 0 이면 안 쓴다 — 일부 단지는 이 값이 비어 있다.
 */
export function buildUnitMix(kapt: KaptRow): UnitMix | null {
  const raw = [
    { label: '60㎡ 이하', units: kapt.units60 ?? 0 },
    { label: '60~85㎡', units: kapt.units85 ?? 0 },
    { label: '85~135㎡', units: kapt.units135 ?? 0 },
    { label: '135㎡ 초과', units: kapt.unitsOver ?? 0 },
  ];
  const total = raw.reduce((sum, b) => sum + b.units, 0);
  if (total <= 0) return null;
  // 세대수와 어긋나면 신뢰할 수 없다 (5% 이상 차이나면 버린다)
  if (kapt.households != null && kapt.households > 0) {
    if (Math.abs(total - kapt.households) / kapt.households > 0.05) return null;
  }
  const small = raw[0].units;
  return {
    bands: raw.map((b) => ({ ...b, pct: round1((b.units / total) * 100) })),
    total,
    allSmall: small === total,
    smallPct: round1((small / total) * 100),
  };
}

export function buildComplexFacts(input: ComplexFactsInput): ComplexFacts {
  const { kapt, saleCount12m, rentCount12m } = input;
  const h = kapt.households && kapt.households > 0 ? kapt.households : null;

  return {
    kaptCode: kapt.kaptCode,
    kaptName: kapt.kaptName,
    addr: kapt.addr,
    roadAddr: kapt.roadAddr,

    households: kapt.households,
    dongCnt: kapt.dongCnt,
    topFloor: kapt.topFloor,
    elevatorCnt: kapt.elevatorCnt,
    approvedAt: formatUseDate(kapt.useDate),
    heatNm: kapt.heatNm,
    hallNm: kapt.hallNm,
    mgrNm: kapt.mgrNm,
    saleNm: kapt.saleNm,
    builder: kapt.builder,

    turnoverPct: h ? round1((saleCount12m / h) * 100) : null,
    saleCount12m,
    rentReportPct: h ? round1((rentCount12m / h) * 100) : null,
    rentCount12m,
    privRatioPct:
      kapt.privArea && kapt.totalArea && kapt.totalArea > 0
        ? round1((kapt.privArea / kapt.totalArea) * 100)
        : null,
    areaPerHousehold: h && kapt.privArea ? round1(kapt.privArea / h) : null,
    pyeongPerHousehold: h && kapt.privArea ? Math.round(kapt.privArea / h / PYEONG) : null,
    aptKind: kapt.aptKind,
    unitMix: buildUnitMix(kapt),
  };
}

/**
 * 회전율을 말로 옮긴다. 절대 기준이 아니라 **서울 평균 대비 감각**이다 —
 * 실측으로 서울 대단지 연 회전율이 대략 2~5% 구간에 몰린다.
 */
export function turnoverLabel(pct: number | null): string | null {
  if (pct == null) return null;
  if (pct < 1.5) return '손바뀜 적음';
  if (pct < 3.5) return '보통';
  if (pct < 6) return '활발';
  return '매우 활발';
}

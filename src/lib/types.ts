/** 국토부 실거래 신고 1건 (정규화 후) */
export type Trade = {
  /** 단지 일련번호 "11680-1234" — 같은 단지를 묶는 안정적인 키 */
  aptSeq: string;
  /** 시군구 법정동코드 5자리 */
  lawdCd: string;
  /** 법정동명 (예: 대치동) */
  umdNm: string;
  /** 단지명 */
  aptNm: string;
  jibun: string | null;
  roadNm: string | null;
  buildYear: number | null;
  /** 전용면적 (m²) */
  area: number;
  floor: number | null;
  /** 계약일 YYYY-MM-DD */
  dealDate: string;
  /** 계약년월 YYYYMM */
  dealYm: string;
  /** 거래금액 (만원) */
  amount: number;
  /** 중개거래 / 직거래 */
  dealingGbn: string | null;
  buyerGbn: string | null;
  slerGbn: string | null;
  /** 해제여부 (해제된 거래는 시세 계산에서 제외) */
  canceled: boolean;
  /** 등기일자 */
  rgstDate: string | null;
};

/** 단지 요약 (검색 결과 목록용) */
export type Complex = {
  aptSeq: string;
  aptNm: string;
  umdNm: string;
  lawdCd: string;
  buildYear: number | null;
  /** 최근 3년 거래 건수 */
  dealCount: number;
  /** 최근 거래일 */
  lastDealDate: string;
  /** 거래된 전용면적 목록 (오름차순, 소수 1자리) */
  areas: number[];
  /** 최근 거래 평단가 (만원/평) */
  recentPricePerPyeong: number;
};

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type Estimate = {
  /** 시세 기준월 YYYY-MM */
  asOf: string;
  /** 대상 전용면적 (m²) */
  area: number;
  /** 대상 층 (미지정 시 null → 중층 가정) */
  floor: number | null;
  /** 예상 실거래가 (만원) */
  price: number;
  /** 80% 예측구간 하단 / 상단 (만원) */
  low: number;
  high: number;
  /** 예상 전용 평단가 (만원/평) */
  pricePerPyeong: number;
  /** 3개월 후 추정가 (지역 지수 추세 연장, 만원) */
  forecast3m: number;
  /** 계산에 사용된 유효 표본 수 */
  sampleSize: number;
  /** 최근 실거래일 */
  lastDealDate: string | null;
  /** 최근 실거래가 (동일 면적대, 만원) */
  lastDealAmount: number | null;
  confidence: ConfidenceLevel;
  method: 'hedonic' | 'weighted-median' | 'region-index';
  /** 지역 가격지수 기준 최근 1년 변동률 (%) */
  regionYoyPct: number;
  /** 단지 가격지수 기준 최근 1년 변동률 (%) — 표본 부족 시 null */
  complexYoyPct: number | null;
  notes: string[];
};

/** 월별 가격지수 포인트 */
export type IndexPoint = {
  /** YYYYMM */
  ym: string;
  /** 지수 (최신월 = 100) */
  index: number;
  /** 해당 월 중위 전용 평단가 (만원/평), 표본 없으면 null */
  medianPricePerPyeong: number | null;
  /** 해당 월 거래 건수 */
  count: number;
};

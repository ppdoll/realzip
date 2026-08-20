/** 조회 창(window) — 최근 36개월 = 3년 */
export const WINDOW_MONTHS = 36;

/**
 * 국토부 API 동시 호출 수.
 * 6 으로 36개월을 몰아 받으면 실제로 HTTP 429(속도 제한)를 맞는다 — 4 로 낮췄다.
 * 그래도 36개월 수집이 10초대에 끝난다.
 */
export const FETCH_CONCURRENCY = 4;

/** 검색 결과 단지 최대 개수 */
export const MAX_COMPLEXES = 400;

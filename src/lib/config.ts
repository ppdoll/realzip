/** 매매 조회 창(window) — 최근 36개월 = 3년 */
export const WINDOW_MONTHS = 36;

/**
 * 전월세 조회 창 — 최근 12개월 = 1년.
 *
 * 전월세는 매매보다 신고량이 5배 가까이 많다(강남구 3년 69,026행 vs 10,488행).
 * 3년치를 전국으로 담으면 Supabase 무료 티어 500MB 를 훌쩍 넘고, 전세 시세는
 * 계약 갱신 주기(2년)를 감안해도 1년이면 판단에 충분하다.
 */
export const RENT_WINDOW_MONTHS = 12;

/**
 * 국토부 API 동시 호출 수.
 * 6 으로 36개월을 몰아 받으면 실제로 HTTP 429(속도 제한)를 맞는다 — 4 로 낮췄다.
 * 그래도 36개월 수집이 10초대에 끝난다.
 */
export const FETCH_CONCURRENCY = 4;

/** 검색 결과 단지 최대 개수 */
export const MAX_COMPLEXES = 400;

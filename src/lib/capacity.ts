import { serverClient } from './supabase';

/**
 * 저장 용량 가드.
 *
 * Supabase 무료 티어는 500MB 다. 사용자가 아직 담지 않은 지역을 열면 온디맨드로
 * 36개월(+전월세 12개월)이 적재되는데, 한계에 닿으면 쓰기가 실패하면서 **이미 담아둔
 * 지역까지 갱신이 막힌다.** 그래서 새 지역 수집만 미리 거절한다 —
 * 읽기와 기존 지역 갱신은 그대로 동작한다.
 *
 * 실제 바이트를 재려면 Postgres 접속이 필요해서, 행 수 × 실측 평균으로 추정한다.
 */

/**
 * 행당 평균 바이트 (인덱스 포함).
 *
 * `npm run db:size` 실측으로 교정해 왔다: 450 -> 390 -> **422**.
 * 390 으로 두면 8% 낮게 봐서 실제로는 한도를 넘었는데 가드가 통과시킨다 —
 * 실제로 그렇게 13개 지역이 들어와 무료 티어를 넘겼다(2026-08-25).
 *
 * VACUUM 직후에는 383B 까지 내려가지만 그 값을 쓰지 않는다. 지우기만 하고
 * 청소하지 않으면 공간이 OS 로 돌아오지 않아 실제 사용량은 계속 이보다 크다.
 * 가드는 **넉넉히 잡아 일찍 막는 쪽**이 맞다.
 */
const BYTES_PER_ROW = 422;
const FREE_TIER_BYTES = 500 * 1024 * 1024;
/** 이 비율을 넘으면 새 지역을 받지 않는다 */
const STOP_RATIO = 0.9;
/** 카운트 캐시 — 콜드 요청마다 세면 낭비다 */
const TTL_MS = 5 * 60 * 1000;
/**
 * 새 지역 하나가 늘리는 행 수 (실측 평균).
 * 76개 지역 1,289,859행 = 지역당 약 17,000행이다.
 */
const ROWS_PER_NEW_REGION = 17_000;

let cache: { rows: number; at: number } | null = null;

async function totalRows(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const db = serverClient();
  const [t, r] = await Promise.all([
    db.from('apt_trade').select('*', { count: 'exact', head: true }),
    db.from('apt_rent').select('*', { count: 'exact', head: true }),
  ]);
  const rows = (t.count ?? 0) + (r.count ?? 0);
  cache = { rows, at: Date.now() };
  return rows;
}

export type CapacityStatus = {
  rows: number;
  estimatedMb: number;
  usedRatio: number;
  /** 새 지역을 더 받을 수 있는지 */
  canIngestNewRegion: boolean;
};

export async function capacityStatus(): Promise<CapacityStatus> {
  const rows = await totalRows();
  const bytes = rows * BYTES_PER_ROW;
  return {
    rows,
    estimatedMb: Math.round((bytes / 1024 / 1024) * 10) / 10,
    usedRatio: bytes / FREE_TIER_BYTES,
    canIngestNewRegion: bytes / FREE_TIER_BYTES < STOP_RATIO,
  };
}

/**
 * 새 지역 수집 직전에 부른다. 한계면 무엇을 해야 하는지 알려주며 던진다.
 *
 * 통과시킬 때 **예상 행 수를 캐시에 미리 더한다.** 캐시가 5분짜리라 그 안에 여러
 * 지역이 몰리면 전부 옛 숫자를 보고 통과한다 — 실제로 2026-08-25 새벽 11분 동안
 * 13개 지역이 그렇게 들어와 무료 티어를 넘겼다. 미리 더해 두면 같은 창 안에서도
 * 다음 요청이 늘어난 값을 본다.
 */
export async function assertCanIngestNewRegion(label: string): Promise<void> {
  const s = await capacityStatus();
  if (s.canIngestNewRegion) {
    if (cache) cache.rows += ROWS_PER_NEW_REGION;
    return;
  }
  throw new Error(
    `저장 용량이 한계에 가까워 새 지역(${label})을 담을 수 없습니다 — ` +
      `현재 약 ${s.estimatedMb}MB (무료 티어 500MB의 ${Math.round(s.usedRatio * 100)}%). ` +
      '이미 담아둔 지역은 그대로 조회됩니다. ' +
      '플랜을 올리거나, 보지 않는 지역을 정리하거나, 전월세 창을 더 줄여 공간을 만드세요.',
  );
}

/** 지역을 정리해 공간이 생겼을 때 캐시를 버린다 */
export function resetCapacityCache(): void {
  cache = null;
}

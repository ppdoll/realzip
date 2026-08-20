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
 * `npm run db:size` 로 실측한 값 — apt_trade 379B, apt_rent 399B (2026-08, 100만 행 기준).
 * 처음엔 450 으로 잡았다가 13% 과대추정이라 교정했다.
 */
const BYTES_PER_ROW = 390;
const FREE_TIER_BYTES = 500 * 1024 * 1024;
/** 이 비율을 넘으면 새 지역을 받지 않는다 */
const STOP_RATIO = 0.92;
/** 카운트 캐시 — 콜드 요청마다 세면 낭비다 */
const TTL_MS = 5 * 60 * 1000;

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

/** 새 지역 수집 직전에 부른다. 한계면 무엇을 해야 하는지 알려주며 던진다. */
export async function assertCanIngestNewRegion(label: string): Promise<void> {
  const s = await capacityStatus();
  if (s.canIngestNewRegion) return;
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

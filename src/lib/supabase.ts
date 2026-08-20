import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

/**
 * 서버 전용 Supabase 클라이언트.
 *
 * supabase-js 2.109 는 전역 WebSocket 이 없으면 **createClient 단계에서 예외를 던진다.**
 * 이 앱은 Realtime 을 전혀 쓰지 않는데도 클라이언트 생성 자체가 막히므로,
 * 전역 WebSocket 이 없는 런타임(Node 20 이하)에서만 ws 를 transport 로 넣어준다.
 * Node 22+ 와 엣지 런타임은 native WebSocket 이 있어 그대로 쓴다.
 *
 * service_role(secret) 키를 쓰므로 서버에서만 import 할 것 — 클라이언트 컴포넌트에서
 * 부르면 키가 브라우저로 나간다.
 */

const hasNativeWebSocket = typeof (globalThis as { WebSocket?: unknown }).WebSocket !== 'undefined';

let cached: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** 환경변수가 없으면 던진다 — 호출 전에 isSupabaseConfigured() 로 확인할 것. */
export function serverClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(hasNativeWebSocket ? {} : { realtime: { transport: ws as never } }),
  });
  return cached;
}

export type KeyKind = 'secret' | 'publishable' | 'anon-jwt' | 'unknown';

export const KEY_LABEL: Record<KeyKind, string> = {
  secret: 'secret 키',
  publishable: 'publishable (공개용) 키',
  'anon-jwt': 'anon (공개용) 키',
  unknown: '알 수 없는 형식의 키',
};

/**
 * 키 종류 판별.
 *  · 새 형식: sb_secret_... / sb_publishable_...
 *  · 옛 형식: JWT — payload 의 role 이 service_role 인지 anon 인지로 구분
 */
export function classifyKey(key: string): KeyKind {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';

  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') return 'secret';
      if (payload.role === 'anon') return 'anon-jwt';
    } catch {
      // JWT 로 안 읽히면 unknown
    }
  }
  return 'unknown';
}

/**
 * 페이지네이션된 전체 조회.
 *
 * PostgREST 는 요청당 기본 1,000행에서 **조용히 잘린다.** 이 프로젝트에서 같은 실수를
 * 세 번 했다 — 전월세 조회에서 최근 6개월이 사라졌고, ingest_log 커버리지 리포트가
 * 지역이 늘자 "누락된 달"을 거짓으로 보고했다. 그래서 전체 조회는 이 헬퍼만 쓴다.
 *
 * 짧은 페이지가 오면 끝이고, 안전 상한에 닿으면 **던진다** — 잘린 결과를 돌려주는 것보다
 * 시끄럽게 실패하는 편이 낫다.
 */
export async function fetchAllPaged<T>(
  makeQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
  },
  opts: { page?: number; hardLimit?: number; label?: string } = {},
): Promise<T[]> {
  const page = opts.page ?? 1000;
  const hardLimit = opts.hardLimit ?? 500_000;
  const label = opts.label ?? '조회';
  const out: T[] = [];

  for (let offset = 0; offset < hardLimit; offset += page) {
    const { data, error } = await makeQuery().range(offset, offset + page - 1);
    if (error) throw new Error(`${label} 실패: ${error.message}`);
    if (!data || data.length === 0) return out;
    out.push(...data);
    if (data.length < page) return out;
  }
  throw new Error(
    `${label}가 안전 상한(${hardLimit.toLocaleString('ko-KR')}행)에 닿았습니다. ` +
      '조용히 자르지 않기 위해 실패로 처리합니다 — 조건을 좁히거나 상한을 올리세요.',
  );
}

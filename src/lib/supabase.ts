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

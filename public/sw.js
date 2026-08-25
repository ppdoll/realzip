/*
 * 서비스 워커.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  이 앱에서 가장 중요한 규칙: **시세 데이터는 캐시하지 않는다.**
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  /api/* 응답을 캐시했다가 나중에 보여주면, 지난주 가격이 오늘 가격처럼 보인다.
 *  실거래가는 매일 신고가 들어와 움직이고(회전율은 최근 1년 이동창이라 날마다
 *  조금씩 바뀐다), 사람이 그 숫자로 판단을 한다. 그래서 API 는 **네트워크만**
 *  쓰고, 실패하면 캐시로 대체하지 않고 그대로 실패시킨다 — 화면에 오류가 뜨는 게
 *  틀린 값이 뜨는 것보다 낫다.
 *
 *  캐시하는 것은 화면을 그리는 껍데기뿐이다:
 *   · /_next/static/*  파일 이름에 해시가 붙어 내용이 바뀌면 이름도 바뀐다.
 *                      그래서 캐시를 먼저 봐도 오래된 것을 볼 위험이 없다.
 *   · 아이콘·매니페스트  바뀌는 일이 드물다. 캐시를 쓰되 뒤에서 새로 받아 둔다.
 *   · 화면 이동(HTML)   네트워크를 먼저 본다. 안 되면 캐시, 그것도 없으면 오프라인 안내.
 *
 *  CACHE_VERSION 을 올리면 예전 캐시를 전부 지운다.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `realzip-${CACHE_VERSION}`;
const OFFLINE_URL = '/offline.html';

/** 설치할 때 미리 받아 두는 것 — 오프라인 안내와 아이콘뿐이다 */
const PRECACHE = [OFFLINE_URL, '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // 하나가 실패해도 설치 자체는 끝내야 한다 (아이콘 하나 때문에 막히면 안 된다)
      await Promise.allSettled(PRECACHE.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('realzip-') && n !== CACHE_NAME).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/** 해시가 붙어 내용이 바뀌면 이름도 바뀌는 파일들 */
const isImmutable = (url) => url.pathname.startsWith('/_next/static/');

/** 아이콘·매니페스트처럼 가끔 바뀌는 것 */
const isAsset = (url) =>
  /^\/(icon|apple-icon|opengraph-image|manifest\.webmanifest|favicon)/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 조회가 아닌 요청은 건드리지 않는다
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 시세 데이터 — 캐시하지도, 캐시로 대체하지도 않는다 (파일 맨 위 설명 참고)
  if (url.pathname.startsWith('/api/')) return;

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isAsset(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(CACHE_NAME)).put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached ?? (await fresh) ?? Response.error();
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    return (await cache.match(request)) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

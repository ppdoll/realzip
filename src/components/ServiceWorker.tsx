'use client';

import { useEffect } from 'react';

/**
 * 서비스 워커 등록.
 *
 * 개발 중에는 등록하지 않는다 — 캐시가 끼면 고친 코드가 화면에 안 나와서
 * 엉뚱한 데를 파게 된다.
 *
 * 무엇을 캐시하고 무엇을 안 하는지는 public/sw.js 맨 위에 적어 두었다.
 * 요약하면 시세(/api/*)는 캐시하지 않고 화면 껍데기만 캐시한다.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // 등록에 실패해도 앱은 그대로 돌아간다 — 오프라인 지원만 없을 뿐이다
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  return null;
}

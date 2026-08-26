/**
 * 사이트의 절대 주소.
 *
 * robots.txt·sitemap.xml·canonical·구조화 데이터가 모두 절대 URL 을 요구한다.
 * 한 곳에서만 만들어야 서로 어긋나지 않는다 — 예전에 layout.tsx 안에만 있어서
 * 다른 곳에서 쓰려면 복사해야 했다.
 *
 * 배포 주소를 바꿀 일이 있으면 NEXT_PUBLIC_APP_URL 로 덮어쓴다.
 * VERCEL_PROJECT_PRODUCTION_URL 은 미리보기 배포에서도 **운영 주소**를 주므로,
 * 미리보기에서 sitemap 이 운영 주소를 가리키는 것이 맞다 (색인은 운영만 받는다).
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000')
).replace(/\/$/, '');

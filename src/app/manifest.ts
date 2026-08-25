import type { MetadataRoute } from 'next';

/**
 * 웹 앱 매니페스트 (/manifest.webmanifest).
 *
 * 홈 화면에 담아 앱처럼 여는 데 필요한 정보다. Next 가 이 파일을 보고
 * <link rel="manifest"> 까지 알아서 넣어 준다.
 *
 * `display: 'standalone'` — 주소창 없이 뜬다. 다만 이 앱은 링크를 밖으로 보내는
 * 일이 없고 화면 안에서 조회만 하므로 주소창이 없어도 갇히지 않는다.
 *
 * 아이콘은 192·512 두 장을 낸다. 512 는 안드로이드 스플래시에, 192 는 홈 화면에
 * 쓰인다. `maskable` 을 따로 두는 이유: 안드로이드가 아이콘을 원형·둥근사각형 등
 * 기기 모양으로 잘라내는데, 잘려도 마크가 살아 있으려면 여백이 넉넉해야 한다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '아파트 실거래가 · 예상 시세',
    short_name: '실거래가',
    description:
      '국토교통부 실거래 신고 데이터로 최근 3년 아파트 매매가를 보고, 지역 가격지수로 보정한 예상 실거래가와 전세가율을 계산합니다.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'ko',
    dir: 'ltr',
    // 첫 화면이 뜨기 전 배경 — 라이트 테마의 페이지 배경과 같게 둬서 깜빡임을 줄인다
    background_color: '#f6f5f2',
    theme_color: '#2a78d6',
    categories: ['finance', 'utilities'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

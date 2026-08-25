import type { Metadata, Viewport } from 'next';
import ServiceWorker from '@/components/ServiceWorker';
import './globals.css';

/**
 * OG·트위터 카드는 **절대 URL** 이 필요해서 metadataBase 를 정한다.
 * 배포 주소를 바꿀 일이 있으면 NEXT_PUBLIC_APP_URL 로 덮어쓴다.
 */
const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:3000');

const title = '아파트 실거래가 · 예상 시세';
const description =
  '국토교통부 실거래 신고 데이터로 최근 3년 아파트 매매가를 보고, 지역 가격지수로 보정한 예상 실거래가와 전세가율을 계산합니다. 비슷한 가격대의 다른 서울 아파트도 함께 추천합니다.';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: { default: title, template: `%s · ${title}` },
  description,
  applicationName: 'realzip',
  keywords: [
    '아파트 실거래가',
    '예상 시세',
    '전세가율',
    '국토교통부 실거래가',
    '아파트 시세 조회',
    '평단가',
  ],
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    url: baseUrl,
    siteName: 'realzip',
    title,
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
  // 실거래가 추정치라 검색 노출 자체는 막지 않지만, 미리보기 텍스트는 그대로 쓰게 둔다
  robots: { index: true, follow: true },
  /**
   * iOS 는 매니페스트를 보지 않는다 — 홈 화면에 담을 때 쓰는 값을 따로 준다.
   * `statusBarStyle: 'default'` 로 두는 이유: 이 앱은 라이트·다크를 모두 쓰는데
   * black-translucent 로 두면 상태바 글자가 배경과 겹쳐 안 보이는 경우가 생긴다.
   */
  appleWebApp: {
    capable: true,
    title: '실거래가',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f5f2' },
    { media: '(prefers-color-scheme: dark)', color: '#121211' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}

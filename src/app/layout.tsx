import type { Metadata, Viewport } from 'next';
import ServiceWorker from '@/components/ServiceWorker';
import { siteUrl } from '@/lib/site-url';
import './globals.css';

/**
 * OG·트위터 카드, canonical, sitemap 이 모두 절대 URL 을 요구한다.
 * 주소는 src/lib/site-url.ts 한 곳에서만 만든다.
 */
const baseUrl = siteUrl;

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
   * 같은 화면이 여러 주소로 열리는 것을 막는다 (물음표가 붙거나 www 가 붙는 경우).
   * 지금은 화면이 하나라 루트만 지정하면 충분하다.
   */
  alternates: { canonical: '/' },
  /**
   * 검색엔진 소유 확인.
   *
   * 이 값들은 **비밀이 아니다.** 페이지 소스에 그대로 드러나도록 만들어진 토큰이고,
   * 값을 안다고 남이 소유권을 주장할 수는 없다 — 사이트에 실제로 심어야 하기 때문이다.
   * 그래서 코드에 두고, 환경변수가 있으면 그쪽을 우선한다(계정을 옮길 때 재배포 없이
   * 갈아끼울 수 있게).
   *
   * `realzip.vercel.app` 은 Vercel 소유 도메인의 하위 주소라 DNS 를 건드릴 수 없다.
   * 그래서 Search Console 에서 "도메인" 속성은 쓸 수 없고 **"URL 접두어" 속성 +
   * HTML 태그** 방식만 가능하다. 나중에 직접 도메인을 붙이면 도메인 속성이 낫다.
   *
   * 값이 없으면 태그를 넣지 않는다 (빈 태그는 확인 실패로 잡힌다).
   */
  verification: (() => {
    const google =
      process.env.GOOGLE_SITE_VERIFICATION ??
      '0PpPo4bINVY-5kETwF3FShArtLEOBEKzb2Remaj32QM';
    const naver = process.env.NAVER_SITE_VERIFICATION;
    return {
      ...(google ? { google } : {}),
      ...(naver ? { other: { 'naver-site-verification': naver } } : {}),
    };
  })(),
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

/**
 * 구조화 데이터 (JSON-LD).
 *
 * 검색엔진에 "이 주소가 무엇인지" 를 기계가 읽는 형태로 알려 준다.
 * **사실만 넣는다** — 별점·후기·가격 같은 것을 지어 넣으면 검색엔진이 스팸으로
 * 보고, 무엇보다 거짓이다. 여기 적는 것은 이름·설명·무료·한국어·제공 데이터 출처뿐이다.
 *
 * SearchAction 은 넣지 않는다. 검색 결과에서 바로 검색창을 띄우는 표시인데,
 * 이 앱은 검색 결과가 주소로 남지 않아서(모두 클라이언트 상태) 가리킬 주소가 없다.
 * 동작하지 않는 주소를 적으면 잘못된 안내가 된다.
 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${baseUrl}/#website`,
      url: baseUrl,
      name: 'realzip',
      alternateName: title,
      description,
      inLanguage: 'ko-KR',
    },
    {
      '@type': 'WebApplication',
      '@id': `${baseUrl}/#app`,
      url: baseUrl,
      name: title,
      description,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'All',
      inLanguage: 'ko-KR',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'KRW' },
      // 데이터 출처를 밝힌다 — 이 앱이 만든 값이 아니라 공공데이터라는 사실
      isBasedOn: {
        '@type': 'Dataset',
        name: '국토교통부 아파트 매매·전월세 실거래가',
        creator: { '@type': 'GovernmentOrganization', name: '국토교통부' },
        url: 'https://www.data.go.kr/data/15126469/openapi.do',
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <ServiceWorker />
        <script
          type="application/ld+json"
          // 우리가 만든 상수라 외부 입력이 섞이지 않는다
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}

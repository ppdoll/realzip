import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '아파트 실거래가 · 예상 시세',
  description:
    '국토교통부 공개 실거래 신고 데이터로 최근 3년 아파트 매매가를 보고, 지역 가격지수로 보정한 예상 실거래가를 계산합니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

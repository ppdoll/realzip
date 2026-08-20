import { ImageResponse } from 'next/og';

/**
 * iOS 홈 화면 아이콘. icon.svg 와 같은 마크를 PNG 로 낸다.
 * 글자가 없어서 한글 폰트를 받아올 필요가 없다 (OG 이미지와 달리).
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  // 32 기준으로 그린 마크를 180 으로 확대 — 비율은 icon.svg 와 같다
  const s = 180 / 32;
  const bar = (x: number, top: number) => ({
    position: 'absolute' as const,
    left: x * s,
    top: top * s,
    width: 5 * s,
    height: (25.5 - top) * s,
    background: '#ffffff',
    borderRadius: `${1.5 * s}px ${1.5 * s}px 0 0`,
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background: '#2a78d6',
          display: 'flex',
        }}
      >
        <div style={bar(6.5, 18.5)} />
        <div style={bar(13.5, 13)} />
        <div style={bar(20.5, 7)} />
      </div>
    ),
    size,
  );
}

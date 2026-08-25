import { ImageResponse } from 'next/og';

/**
 * 파비콘·앱 아이콘에 쓰는 마크를 PNG 로 낸다.
 *
 * icon.svg 와 같은 그림이다 — 오르는 막대 셋, 위만 둥글고 바닥은 각지다.
 * 한 곳에서만 그려야 아이콘끼리 어긋나지 않는다.
 *
 * `padding` 은 마스커블 아이콘용이다. 안드로이드는 아이콘을 기기 모양대로
 * 잘라내는데, 안전 영역이 한 변의 80% 라 그 밖은 잘려 나갈 수 있다.
 * 여백 없이 꽉 채운 그림을 마스커블로 내면 막대 끝이 잘린다.
 */
export function markPng(size: number, padding = 0) {
  // 32 기준으로 그린 마크를 요청 크기로 확대한다
  const inner = size * (1 - padding * 2);
  const s = inner / 32;
  const off = size * padding;
  const bar = (x: number, top: number) => ({
    position: 'absolute' as const,
    left: off + x * s,
    top: off + top * s,
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
    { width: size, height: size },
  );
}

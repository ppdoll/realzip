import { ImageResponse } from 'next/og';

/**
 * 링크 미리보기 이미지 (1200×630).
 *
 * 한글이 들어가므로 **한글 글리프를 가진 폰트를 반드시 넘겨야 한다** — 기본 폰트로는
 * 한글이 빈 사각형으로 나온다. 폰트는 런타임에 받아오고, Next 가 생성 결과를
 * 캐시하므로 실제 요청마다 받아오지는 않는다.
 *
 * 폰트를 못 받아오면 글자가 깨진 이미지를 내보내는 대신 **글자 없는 도형 버전**으로
 * 물러난다 — 깨진 글자가 박힌 미리보기가 더 나쁘다.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = '아파트 실거래가 · 예상 시세';

const FONT_URL =
  'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-kr@latest/korean-700-normal.ttf';

const BLUE = '#2a78d6';
const ORANGE = '#eb6834';
const SURFACE = '#fcfcfb';
const INK = '#0b0b0b';
const INK_2 = '#52514e';
const GRID = '#eae8e1';

async function loadFont(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(FONT_URL, { next: { revalidate: 60 * 60 * 24 * 30 } });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/** 마크 (파비콘과 같은 형태) */
function Mark({ scale = 1 }: { scale?: number }) {
  const s = (56 / 32) * scale;
  const bar = (x: number, top: number) => ({
    position: 'absolute' as const,
    left: x * s,
    top: top * s,
    width: 5 * s,
    height: (25.5 - top) * s,
    background: '#ffffff',
    borderRadius: `${1.5 * s}px ${1.5 * s}px 0 0`,
  });
  return (
    <div
      style={{
        position: 'relative',
        width: 32 * s,
        height: 32 * s,
        background: BLUE,
        borderRadius: 7 * s,
        display: 'flex',
      }}
    >
      <div style={bar(6.5, 18.5)} />
      <div style={bar(13.5, 13)} />
      <div style={bar(20.5, 7)} />
    </div>
  );
}

/** 오른쪽 장식 차트 — 실제 데이터가 아니라 "무엇을 보는 도구인지"를 알리는 그림 */
function MiniChart() {
  const points = [34, 30, 38, 33, 46, 42, 55, 60, 58, 72, 80, 92];
  const w = 440;
  const h = 240;
  // 점의 링과 예상 구간이 오른쪽에서 잘리지 않도록 안쪽 여백을 둔다
  const padX = 14;
  const padY = 20;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;
  const step = plotW / (points.length - 1);
  const xAt = (i: number) => padX + i * step;
  const yAt = (v: number) => padY + plotH - (v / 100) * plotH;

  const bandLeft = xAt(points.length - 1) - step * 1.35;
  const bandRight = xAt(points.length - 1) + 10;
  const lastY = yAt(points[points.length - 1]);

  return (
    <div style={{ position: 'relative', width: w, height: h, display: 'flex' }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: padX,
            top: padY + (plotH / 3) * i,
            width: plotW,
            height: 1,
            background: GRID,
          }}
        />
      ))}

      {/* 예상 구간 — 점 아래에 깔아 점이 위로 보이게 한다 */}
      <div
        style={{
          position: 'absolute',
          left: bandLeft,
          top: lastY - 36,
          width: bandRight - bandLeft,
          height: 72,
          borderRadius: 8,
          background: 'rgba(235, 104, 52, 0.16)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: bandLeft,
          top: lastY - 1,
          width: bandRight - bandLeft,
          height: 3,
          borderRadius: 2,
          background: ORANGE,
        }}
      />

      {points.map((p, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: xAt(i) - 5,
            top: yAt(p) - 5,
            width: 10,
            height: 10,
            borderRadius: 5,
            background: BLUE,
            border: `2px solid ${SURFACE}`,
          }}
        />
      ))}
    </div>
  );
}

export default async function OpenGraphImage() {
  const font = await loadFont();

  const chip = (text: string) => (
    <div
      key={text}
      style={{
        display: 'flex',
        padding: '8px 18px',
        borderRadius: 999,
        border: `1px solid ${GRID}`,
        background: '#f6f5f2',
        color: INK_2,
        fontSize: 24,
      }}
    >
      {text}
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: SURFACE,
          padding: 64,
          position: 'relative',
        }}
      >
        {/* 왼쪽: 이름과 설명 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <Mark />
            {font && (
              <div style={{ display: 'flex', color: INK_2, fontSize: 26 }}>realzip</div>
            )}
          </div>

          {font ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'flex', fontSize: 68, color: INK, lineHeight: 1.15 }}>
                아파트 실거래가
              </div>
              <div style={{ display: 'flex', fontSize: 68, color: BLUE, lineHeight: 1.15 }}>
                예상 시세
              </div>
              <div style={{ display: 'flex', fontSize: 27, color: INK_2, marginTop: 8 }}>
                국토교통부 실거래 신고 데이터 · 최근 3년
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', fontSize: 72, color: INK }}>realzip</div>
          )}

          {font && (
            <div style={{ display: 'flex', gap: 12 }}>
              {['예상 실거래가', '전세가율', '비슷한 가격대 추천'].map(chip)}
            </div>
          )}
        </div>

        {/* 오른쪽: 장식 차트 */}
        <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 40 }}>
          <MiniChart />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: 'NotoSansKR', data: font, weight: 700 as const, style: 'normal' as const }]
        : undefined,
    },
  );
}

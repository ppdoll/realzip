'use client';

import { useEffect, useState } from 'react';

/**
 * 카카오 애드핏 광고.
 *
 *   banner  728×90   본문 위쪽 가로 배너 (PC 주력)
 *   rail    160×600  왼쪽 세로 배너 (아주 넓은 화면에서만)
 *   mobile  320×100  화면 아래 가로 배너
 *
 * ── 왜 세 자리인가 ────────────────────────────────────────────────────────
 * 처음엔 세로 배너(160×600)만 PC 용으로 뒀는데 **잘 안 보였다.** 왼쪽 칸을
 * 1280px 이상에서만 만들기 때문이다 — 노트북 1366×768 은 통과하지만 창을 꽉 채우지
 * 않은 브라우저나 1280 화면(스크롤바를 빼면 1265)은 그보다 좁아서 모바일 배너로
 * 넘어간다. PC 로 보는데 모바일 배너가 뜨는 것이다.
 *
 * 가로 배너는 본문 안에 들어가므로 그 문제가 없다. 그래서 이쪽을 PC 주력으로 쓴다.
 *
 * ── 폭 기준을 이렇게 잡은 이유 ────────────────────────────────────────────
 * 728 이 본문에 들어가야 한다. 본문 폭은 배치에 따라 이렇게 변한다:
 *   1단(≤960)      본문 = 화면 - 40
 *   2단(961~1279)  본문 = min(1100, 화면-40) - 312   ← 1100 화면에서 748
 *   3단(≥1280)     본문 = min(1280, 화면-40) - 504   ← 1280 화면에서 776
 * 그래서 가로 배너는 **1100 이상**에서만 그린다. 1080 이면 본문이 정확히 728 이라
 * 여유가 없다. 그보다 좁으면 모바일 배너로 넘어간다.
 *
 * ── 지키는 규칙 ──────────────────────────────────────────────────────────
 * · 안 보이는 광고를 그리지 않는다. 숨긴 광고도 스크립트가 노출로 세면 실제로
 *   보이지 않은 노출이 잡힌다. 그래서 CSS 로 숨기지 않고 **DOM 에 넣지 않는다.**
 * · 스크립트(ba.min.js)는 **자리를 그린 뒤에** 붙인다. 순서가 반대면 훑을 자리가
 *   없어서 광고가 안 나온다.
 * · 보이는 자리가 바뀌면 스크립트를 다시 붙인다. 애드핏은 한 번 훑고 마는 방식이라
 *   자리만 바꿔치기하면 빈 칸으로 남는다.
 */

const SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

const SLOTS = {
  banner: { unit: 'DAN-eb8lRnY7Il1wRJaQ', width: 728, height: 90, minWidth: 1100 },
  rail: { unit: 'DAN-pRY0GIMF1vRtPYpC', width: 160, height: 600, minWidth: 1280 },
  mobile: { unit: 'DAN-cIq90WzCnCcgWwVZ', width: 320, height: 100, minWidth: 0, maxWidth: 1099 },
} as const;

export type AdSlot = keyof typeof SLOTS;

/**
 * 지금 화면에 그려진 자리들. 바뀔 때 스크립트를 다시 붙여야 하는데, 여러 자리가
 * 동시에 붙거나 떨어지므로 한 번만 붙도록 모아서 처리한다.
 */
const mounted = new Set<AdSlot>();
let injectQueued = false;

function reinjectScript() {
  if (injectQueued) return;
  injectQueued = true;
  // 같은 틱에 붙는 자리들을 모두 기다린 뒤 한 번만 붙인다
  setTimeout(() => {
    injectQueued = false;
    if (mounted.size === 0) return;
    document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`).forEach((el) => el.remove());
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    document.body.appendChild(s);
  }, 0);
}

function fits(slot: AdSlot, width: number): boolean {
  const s = SLOTS[slot];
  if (width < s.minWidth) return false;
  return !('maxWidth' in s) || width <= (s as { maxWidth: number }).maxWidth;
}

export default function AdFit({ slot }: { slot: AdSlot }) {
  /** 서버에서는 폭을 알 수 없다 — 붙은 뒤에 정한다 */
  const [show, setShow] = useState(false);

  useEffect(() => {
    const apply = () => setShow(fits(slot, window.innerWidth));
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [slot]);

  useEffect(() => {
    if (!show) return;
    mounted.add(slot);
    reinjectScript();
    return () => {
      mounted.delete(slot);
    };
  }, [show, slot]);

  if (!show) return null;
  const { unit, width, height } = SLOTS[slot];

  return (
    <div className={`adfit adfit-${slot}`}>
      <ins
        className="kakao_ad_area"
        style={{ display: 'none' }}
        data-ad-unit={unit}
        data-ad-width={String(width)}
        data-ad-height={String(height)}
      />
    </div>
  );
}

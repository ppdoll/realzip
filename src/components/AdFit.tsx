'use client';

import { useEffect, useState } from 'react';

/**
 * 카카오 애드핏 광고.
 *
 *  · PC   160×600  오른쪽 세로 배너
 *  · 모바일 320×100 화면 아래 가로 배너
 *
 * 두 가지를 다 그려 놓고 CSS 로 하나를 숨기지 않는다. 숨긴 광고도 스크립트가
 * 노출로 세면 실제로 보이지 않은 노출이 잡히기 때문이다. 그래서 화면 폭을 보고
 * **하나만 DOM 에 넣는다.**
 *
 * 스크립트(ba.min.js)는 **광고 자리를 그린 뒤에** 붙인다. 순서가 반대면 스크립트가
 * 훑을 때 자리가 없어서 광고가 안 나온다.
 *
 * 폭이 바뀌어 다른 쪽으로 넘어가면 스크립트를 다시 붙인다. 애드핏은 한 번 훑고
 * 마는 방식이라 자리만 바꿔치기하면 빈 칸으로 남는다. 실제로 겪었다 — 탭이 좁게
 * 열렸다가 넓어지자 PC 화면에 모바일 광고가 남아 있었다.
 */

const SCRIPT_SRC = 'https://t1.kakaocdn.net/kas/static/ba.min.js';

/** 오른쪽 칸이 사라지는 폭 — globals.css 의 .layout 분기와 같은 값이어야 한다 */
const MOBILE_MAX_WIDTH = 960;

const UNITS = {
  pc: { unit: 'DAN-pRY0GIMF1vRtPYpC', width: 160, height: 600 },
  mobile: { unit: 'DAN-cIq90WzCnCcgWwVZ', width: 320, height: 100 },
} as const;

type Kind = keyof typeof UNITS;

export default function AdFit({ kind }: { kind: Kind }) {
  /** 서버에서는 폭을 알 수 없다 — 붙은 뒤에 정한다 */
  const [current, setCurrent] = useState<Kind | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const apply = () => setCurrent(mq.matches ? 'mobile' : 'pc');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const show = current === kind;

  useEffect(() => {
    if (!show) return;
    // 이미 붙어 있으면 지우고 다시 붙인다 — 새로 그린 자리를 훑게 하려면 이 방법뿐이다
    document.querySelectorAll(`script[src="${SCRIPT_SRC}"]`).forEach((el) => el.remove());
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    document.body.appendChild(s);
  }, [show]);

  if (!show) return null;
  const { unit, width, height } = UNITS[kind];

  return (
    <div className={`adfit adfit-${kind}`}>
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

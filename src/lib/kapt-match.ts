/**
 * 실거래 단지 → 단지정보(K-apt) 매칭 규칙 — **한 곳에만 둔다.**
 *
 * 상세 카드는 단지 하나를 DB 에서 찾고(`findKapt`), 구 분포는 수백 단지를 메모리에서
 * 맞춘다(`regionTurnover`). 두 곳이 각자 규칙을 쓰면 같은 단지가 카드에는 값이 있고
 * 분포에는 없는 상태가 된다 — 실제로 래미안대치팰리스가 그렇게 빠졌다.
 * 그래서 규칙은 이 파일의 순수 함수 하나로 두고 양쪽이 불러 쓴다.
 *
 * 규칙 순서:
 *   1. 같은 법정동 + 같은 지번 (이게 주력 — 실측 조인율 79%)
 *   2. 지번이 겹치면 이름으로 가린다
 *   3. 지번으로 못 찾으면 같은 법정동에서 이름 포함 관계로 (숫자가 다르면 제외)
 *   4. 후보가 둘 이상이면 포기한다 — 잘못 붙이는 것보다 안 붙이는 게 낫다
 */

export type KaptCandidate = {
  umdNm: string;
  jibun: string | null;
  kaptName: string;
};

export type TradeIdentity = {
  umdNm: string | null;
  jibun: string | null;
  aptNm: string;
};

export const normName = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, '').replace(/[()[\]·.,\-_/]/g, '').toLowerCase();

/** 단지명에 든 숫자들 — "까치마을 1단지" 와 "2단지" 를 구분하는 데 쓴다 */
const digitsOf = (v: string): string => (v.match(/\d+/g) ?? []).join(',');

function nameMatches(kaptName: string, target: string): boolean {
  const n = normName(kaptName);
  if (!n || !target) return false;
  const dn = digitsOf(n);
  const dt = digitsOf(target);
  // 양쪽에 숫자가 있으면 같아야 한다 (1단지 ≠ 2단지)
  if (dn && dt && dn !== dt) return false;
  return n === target || n.includes(target) || target.includes(n);
}

/**
 * 후보 목록에서 이 거래 단지에 해당하는 것을 고른다. 확신이 없으면 null.
 *
 * 후보는 **같은 시군구** 로 이미 좁혀져 있다고 본다 (법정동까지 좁혀 넘기면 더 좋다).
 */
export function matchKapt<T extends KaptCandidate>(candidates: T[], target: TradeIdentity): T | null {
  if (candidates.length === 0) return null;
  const dong = normName(target.umdNm);
  const name = normName(target.aptNm);
  const inDong = candidates.filter((c) => normName(c.umdNm) === dong);
  if (inDong.length === 0) return null;

  if (target.jibun) {
    const sameJibun = inDong.filter((c) => c.jibun === target.jibun);
    if (sameJibun.length === 1) return sameJibun[0];
    if (sameJibun.length > 1) {
      const hit = sameJibun.find((c) => nameMatches(c.kaptName, name));
      if (hit) return hit;
      return null; // 같은 지번에 여러 단지인데 이름으로도 못 가리면 포기
    }
  }

  const byName = inDong.filter((c) => nameMatches(c.kaptName, name));
  return byName.length === 1 ? byName[0] : null;
}

/**
 * 같은 후보 목록에 수백 번 물어볼 때 쓰는 색인판.
 * 법정동으로 미리 나눠 두어 매번 전체를 훑지 않는다.
 */
export function kaptMatcher<T extends KaptCandidate>(candidates: T[]): (t: TradeIdentity) => T | null {
  const byDong = new Map<string, T[]>();
  for (const c of candidates) {
    const k = normName(c.umdNm);
    const arr = byDong.get(k);
    if (arr) arr.push(c);
    else byDong.set(k, [c]);
  }
  return (t: TradeIdentity) => matchKapt(byDong.get(normName(t.umdNm)) ?? [], t);
}

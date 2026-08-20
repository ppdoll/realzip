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

/**
 * 이름 비교용으로 양쪽에 공통으로 붙는 군더더기를 떼어 낸다.
 *
 * 실거래 자료는 한 단지를 블록으로 쪼개 "상계주공16(고층)" 으로 오는데
 * K-apt 는 "상계주공16단지" 다. 어느 쪽도 다른 쪽을 포함하지 않아서 포함 관계로는
 * 절대 못 맞춘다. 단지·아파트·고층·저층은 구분에 쓰이는 말이 아니라서 떼도 안전하고,
 * 단지 번호는 숫자로 따로 확인하므로 "1단지 -> 1" 이 되어도 2단지와 섞이지 않는다.
 */
const stripGeneric = (n: string): string =>
  n.replace(/단지|아파트|고층|저층/g, '') || n;

/**
 * 단지명에 든 숫자들 — "까치마을 1단지" 와 "2단지" 를 구분하는 데 쓴다.
 *
 * **정규화 전 원본에서 뽑는다.** normName 이 하이픈을 지우기 때문에 정규화 뒤에 뽑으면
 * "월계6-2초안" 이 [62] 가 되어 "초안2" 의 [2] 와 안 겹치게 된다. 원본에서 뽑으면 [6,2] 다.
 */
const digitsOf = (v: string): number[] => (v.match(/\d+/g) ?? []).map(Number);

/**
 * 숫자가 서로 완전히 어긋나면 true — 같은 지번이어도 다른 단지로 본다.
 *
 * "같아야 한다" 가 아니라 **"하나라도 겹쳐야 한다"** 로 판단한다.
 * 실거래 단지명에는 동 번호나 지번이 딸려 오기 때문이다. 실측(강남·노원 19건):
 *   현대8차(성수현대:91~95동) [8,91,95] ↔ 압구정현대8차 [8]        → 8 이 겹친다, 같은 단지
 *   청암3단지(582)            [3,582]   ↔ 중계청암3단지 [3]         → 3 이 겹친다, 같은 단지
 *   초안2                     [2]       ↔ 월계6-2초안 [6,2]         → 2 가 겹친다, 같은 단지
 *   한양5                     [5]       ↔ 압구정한양3단지 [3]       → 하나도 안 겹친다, 다른 단지
 *   상계주공16(고층)          [16]      ↔ 상계주공15단지 [15]       → 하나도 안 겹친다, 다른 단지
 * "같아야 한다" 로 하면 위 16건 중 앞의 셋 같은 정상 조인까지 전부 잃는다.
 */
function numbersConflict(aName: string, bName: string): boolean {
  const a = digitsOf(aName);
  const b = digitsOf(bName);
  // 한쪽에 숫자가 없으면 번호로 가릴 수 없다 — 거부 근거가 되지 못한다
  if (a.length === 0 || b.length === 0) return false;
  return !a.some((n) => b.includes(n));
}

/** 원본 이름 두 개를 견준다 (숫자는 원본에서, 문자열 비교는 정규화 후) */
function nameMatches(kaptName: string, targetRaw: string): boolean {
  const n = normName(kaptName);
  const t = normName(targetRaw);
  if (!n || !t) return false;
  // 번호가 완전히 어긋나면 다른 단지다 (1단지 ≠ 2단지)
  if (numbersConflict(kaptName, targetRaw)) return false;
  if (n === t || n.includes(t) || t.includes(n)) return true;
  // 군더더기를 떼고 다시 (상계주공16단지 ↔ 상계주공16고층)
  const sn = stripGeneric(n);
  const st = stripGeneric(t);
  return sn === st || sn.includes(st) || st.includes(sn);
}

/**
 * 후보 목록에서 이 거래 단지에 해당하는 것을 고른다. 확신이 없으면 null.
 *
 * 후보는 **같은 시군구** 로 이미 좁혀져 있다고 본다 (법정동까지 좁혀 넘기면 더 좋다).
 */
export function matchKapt<T extends KaptCandidate>(candidates: T[], target: TradeIdentity): T | null {
  if (candidates.length === 0) return null;
  const dong = normName(target.umdNm);
  const name = target.aptNm;
  const inDong = candidates.filter((c) => normName(c.umdNm) === dong);
  if (inDong.length === 0) return null;

  if (target.jibun) {
    const sameJibun = inDong.filter((c) => c.jibun === target.jibun);
    // 지번이 하나만 걸리면 이름은 보지 않는다 — 표기가 너무 갈려서 이름을 조건으로 걸면
    // "THESHARP판교퍼스트파크" 같은 것들이 통째로 빠진다. 지번이 가장 강한 근거다.
    // 단, **단지 번호가 서로 다르면 거부한다.** K-apt 가 상계주공15·16단지를 같은
    // 지번(상계동 624)에 올려 둔 것처럼 지번이 겹치는 경우가 실제로 있어서,
    // 그럴 때 번호를 무시하면 엉뚱한 단지의 세대수를 가져다 쓴다.
    if (sameJibun.length === 1) {
      return numbersConflict(sameJibun[0].kaptName, name) ? null : sameJibun[0];
    }
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

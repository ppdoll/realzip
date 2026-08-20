import { PYEONG } from './stats';

/**
 * ────────────────────────────────────────────────────────────────────────
 *  평형 구간과 "보통 몇 룸"
 * ────────────────────────────────────────────────────────────────────────
 *
 *  **방 갯수는 실거래가 자료에 없다.** 국토부 실거래 API 는 전용면적·층·금액·
 *  건축년도만 주고, K-apt 단지정보에도 방 수 필드가 없다. 그래서 여기서 거르는
 *  기준은 어디까지나 **면적**이고, 방 수는 "이 면적대는 보통 몇 룸" 이라는
 *  참고 표기일 뿐이다 — 데이터가 아니라 통념이다.
 *
 *  통념이라도 붙여 두는 이유: 사람은 "66~99㎡" 보다 "20평대, 보통 3룸" 으로
 *  집을 찾는다. 다만 실제로는 같은 84㎡ 안에서도 3룸과 4룸이 갈리고, 최근
 *  평면은 59㎡ 에도 3룸을 넣는다. 그래서 화면에서 "추정" 이라고 못박고
 *  거르는 조건에는 쓰지 않는다.
 */

export type AreaBand = {
  key: string;
  label: string;
  /** 전용면적 하한 (㎡) */
  min: number;
  /** 전용면적 상한 (㎡) */
  max: number;
  /** 이 면적대에 흔한 방 수 — 참고용 */
  rooms: string;
};

/** 평 → ㎡ */
export const py2m2 = (py: number) => py * PYEONG;
/** ㎡ → 평 (소수 1자리) */
export const m22py = (m2: number) => Math.round((m2 / PYEONG) * 10) / 10;

/**
 * 구간은 **전용면적 ㎡** 로 자른다 — 평으로 자르면 어긋난다.
 *
 * 사람들이 말하는 "34평" 은 공급면적이고 전용은 84㎡(25.4평)다. 전용 평으로
 * "30평대" 를 만들면 84㎡ 가 25평이라 20평대로 떨어지고, 전용 59㎡(17.9평,
 * 흔히 24평형이라 부르는 표준 3룸)는 "10평대" 로 밀려 "원룸~2룸" 이 붙는다.
 * 실제로 그렇게 만들어 놓고 테스트에서 잡았다.
 *
 * 그래서 청약·세금·K-apt 가 모두 쓰는 전용면적 기준(60 / 85 / 135㎡)을 따른다.
 * 평 입력은 그대로 받는다 — 사람은 평으로 생각하니 범위는 평으로 넣게 하고,
 * 구간 라벨만 어긋나지 않는 기준으로 적는다.
 */
export const AREA_BANDS: AreaBand[] = [
  { key: 'b40', label: '전용 40㎡ 이하', min: 0, max: 40, rooms: '원룸~2룸' },
  { key: 'b60', label: '40~60㎡', min: 40, max: 60, rooms: '보통 2~3룸' },
  { key: 'b85', label: '60~85㎡', min: 60, max: 85, rooms: '보통 3룸' },
  { key: 'b135', label: '85~135㎡', min: 85, max: 135, rooms: '보통 3~4룸' },
  { key: 'bmax', label: '135㎡ 초과', min: 135, max: 1000, rooms: '4룸 이상' },
];

/**
 * 어느 구간에 드는지 — 없으면 null.
 *
 * **위쪽 경계를 포함한다** (min < area <= max). 국민주택 규모가 전용
 * "85㎡ 이하" 라서 85.0 은 60~85 구간에 들어가야 한다. 아래를 포함하는 식으로
 * 하면 84.9 와 85.0 이 다른 구간이 되어, 같은 25.7평 두 줄에 "보통 3룸" 과
 * "보통 3~4룸" 이 나란히 붙는다 (실제로 화면에서 그렇게 나왔다).
 */
export function bandOf(area: number): AreaBand | null {
  if (!(area > 0)) return null;
  return AREA_BANDS.find((b) => area > b.min && area <= b.max) ?? null;
}

/** 이 면적이면 보통 몇 룸인지 (참고용 문구) */
export function roomsHint(area: number): string | null {
  return bandOf(area)?.rooms ?? null;
}

/**
 * 같은 단지 안에서 서로 가까운 전용면적을 한 타입으로 묶는 함수를 만든다.
 *
 * 정수 ㎡ 로 반올림하면 경계에 걸린 값이 갈린다 — 84.44 는 84, 84.57 은 85 가 되어
 * 같은 84㎡ 타입이 두 줄로 나뉜다. 실측(6개 지역 24,513건)으로 정수 반올림은
 * 1.5㎡ 안쪽인 236쌍을 잘못 쪼갰다. 대신 정렬해서 이웃과의 간격이 기준보다
 * 벌어질 때만 새 묶음을 시작하면(단일 연결) 그 문제가 없다.
 *
 * 기준 1.5㎡ 는 상세 화면이 "같은 평형" 으로 쓰는 값과 같다. 사슬처럼 번져
 * 폭이 넓어지는 묶음이 생길 수 있는데(실측 3,526개 중 20개가 1.5㎡ 초과,
 * 3개가 3㎡ 초과) 정수 반올림의 236쌍보다 훨씬 적다.
 *
 * **매매와 전월세를 견줄 때는 두 쪽 면적을 합쳐서 만들어야 한다** — 따로 만들면
 * 같은 타입이 서로 다른 묶음 번호를 받아 짝이 맞지 않는다.
 */
export const AREA_CLUSTER_GAP = 1.5;

export function areaClusterer(values: number[], gap = AREA_CLUSTER_GAP): (v: number) => number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const map = new Map<number, number>();
  let id = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > gap) id++;
    map.set(sorted[i], id);
  }
  // 모르는 값은 가장 가까운 묶음에 붙인다 (간격 안이면) — 없으면 -1
  return (v) => {
    const hit = map.get(v);
    if (hit !== undefined) return hit;
    let best = -1;
    let bestGap = Infinity;
    for (const [k, cid] of map) {
      const d = Math.abs(k - v);
      if (d <= gap && d < bestGap) {
        bestGap = d;
        best = cid;
      }
    }
    return best;
  };
}

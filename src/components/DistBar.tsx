'use client';

export type Positioned = {
  value: number;
  distribution: { count: number; median: number; p25: number; p75: number };
  percentile: number;
  vsMedian: number;
};

/** 2 가 아니라 2.0 으로 — 옆에 놓인 40.3 과 자릿수가 맞아야 눈으로 비교된다 */
const fmt1 = (v: number) => v.toFixed(1);

/**
 * 구 분포 안에서의 위치를 한 줄로 보여준다.
 *
 * 형태를 이렇게 고른 이유: 값 하나를 분포와 견주는 일이라 막대(크기 비교)나
 * 선(시간 변화)이 아니라 **띠 위의 눈금** 이 맞다. 회색 띠가 구의 중간 절반(p25~p75),
 * 세로 실선이 중위, 파란 점이 이 단지다.
 *
 * 축 아래 양 끝에는 그쪽이 무슨 뜻인지만 적고, 숫자는 범례에 각 표시와 나란히 붙인다 —
 * 축 가운데에 "중위 2.0%" 를 적으면 중위선이 가운데 있는 줄로 읽히는데 실제로는 아니다.
 *
 * 색은 위치에 따라 바꾸지 않는다. 회전율이 낮은 게 좋은지 나쁜지는 상황에 따라
 * 다르고(재건축 대기 단지는 낮은 게 정상), 색으로 좋다/나쁘다를 암시하면
 * 사실 전달이 아니라 판단 제시가 된다. 표시끼리는 색 말고 **모양**(점·선·띠)으로도
 * 구분되니 색을 못 보는 경우에도 읽힌다.
 */
export default function DistBar({
  pos,
  unit = '%',
  regionLabel,
  lowLabel,
  highLabel,
}: {
  pos: Positioned;
  unit?: string;
  regionLabel: string;
  /** 낮은 쪽·높은 쪽이 무슨 뜻인지 (예: "손바뀜 적음" / "손바뀜 활발") */
  lowLabel?: string;
  highLabel?: string;
}) {
  const d = pos.distribution;
  // 축 범위는 분포와 이 단지 값을 모두 담되 여유를 조금 둔다
  const lo = Math.min(d.p25, pos.value);
  const hi = Math.max(d.p75, pos.value);
  const pad = Math.max((hi - lo) * 0.35, 0.4);
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const span = Math.max(max - min, 0.001);
  const at = (v: number) => ((v - min) / span) * 100;

  const bandLeft = at(d.p25);
  const bandRight = at(d.p75);
  const fmt = (v: number) => `${fmt1(v)}${unit}`;

  return (
    <div className="distbar">
      <div
        className="distbar-track"
        role="img"
        aria-label={`${regionLabel} 분포에서 이 단지는 ${fmt(pos.value)}로 하위 ${
          pos.percentile
        }%입니다. 구 가운데 절반은 ${fmt(d.p25)}~${fmt(d.p75)}, 중위는 ${fmt(d.median)}입니다.`}
      >
        <span
          className="distbar-band"
          style={{ left: `${bandLeft}%`, width: `${Math.max(bandRight - bandLeft, 1)}%` }}
        />
        <span className="distbar-median" style={{ left: `${at(d.median)}%` }} />
        <span className="distbar-dot" style={{ left: `${at(pos.value)}%` }} />
      </div>

      <div className="distbar-ends">
        <span>{lowLabel ?? fmt(min)}</span>
        <span>{highLabel ?? fmt(max)}</span>
      </div>

      <div className="distbar-legend">
        <span className="distbar-key">
          <i className="k-dot" />이 단지 <b className="tabular">{fmt(pos.value)}</b>
        </span>
        <span className="distbar-key">
          <i className="k-median" />
          {regionLabel} 중위 <b className="tabular">{fmt(d.median)}</b>
        </span>
        <span className="distbar-key">
          <i className="k-band" />가운데 절반{' '}
          <b className="tabular">
            {fmt1(d.p25)}~{fmt(d.p75)}
          </b>
        </span>
        <span className="distbar-n">단지 {d.count}곳 기준</span>
      </div>
    </div>
  );
}

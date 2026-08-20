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

  /**
   * 축은 **분포를 기준으로** 잡고, 이 단지 값이 그 밖이면 끌어다 붙이지 않는다.
   *
   * 값에 축을 맞추면 극단값 하나가 그림을 망친다. 실측: 강서구 더트루엘마곡HQ 는
   * 2024년 준공 신축이라 회전율이 58.1% 인데(86건/148세대 — 입주장이라 정상이다),
   * 강남구 p25 1.2 / p75 3.5 짜리 축에 그 값을 담으면 가운데 절반 띠가 폭 3% 로
   * 짜부라져서 아무것도 안 보인다.
   *
   * 그래서 축을 사분위 범위의 1.5배까지만 두고, 벗어난 값은 끝에 삼각형으로 붙인다 —
   * "이 방향으로 더 멀리 있다" 는 뜻이고, 정확한 값은 범례에 적혀 있다.
   */
  const iqr = Math.max(d.p75 - d.p25, 0.1);
  const axisLo = Math.max(0, d.p25 - iqr * 1.5);
  const axisHi = d.p75 + iqr * 1.5;
  const offScale = pos.value < axisLo ? 'low' : pos.value > axisHi ? 'high' : null;

  // 값이 축 안이면 여유를 조금 둬서 끝에 붙지 않게 한다
  const min = offScale ? axisLo : Math.max(0, Math.min(axisLo, pos.value - iqr * 0.3));
  const max = offScale ? axisHi : Math.max(axisHi, pos.value + iqr * 0.3);
  const span = Math.max(max - min, 0.001);
  const at = (v: number) => ((Math.min(Math.max(v, min), max) - min) / span) * 100;

  const bandLeft = at(d.p25);
  const bandRight = at(d.p75);
  const fmt = (v: number) => `${fmt1(v)}${unit}`;

  const rank =
    pos.percentile <= 10
      ? '가장 낮은 편'
      : pos.percentile >= 90
        ? '가장 높은 편'
        : `하위 ${pos.percentile}%`;

  return (
    <div className="distbar">
      <div
        className="distbar-track"
        role="img"
        aria-label={
          `${regionLabel} 단지 ${d.count}곳 분포에서 이 단지는 ${fmt(pos.value)}로 ${rank}입니다. ` +
          `가운데 절반은 ${fmt(d.p25)}~${fmt(d.p75)}, 중위는 ${fmt(d.median)}입니다.` +
          (offScale
            ? ` 이 단지 값은 그림에 표시된 범위(${fmt(min)}~${fmt(max)})를 벗어나 ${
                offScale === 'high' ? '오른쪽' : '왼쪽'
              } 끝에 표시했습니다.`
            : '')
        }
      >
        <span
          className="distbar-band"
          style={{ left: `${bandLeft}%`, width: `${Math.max(bandRight - bandLeft, 1)}%` }}
        />
        <span className="distbar-median" style={{ left: `${at(d.median)}%` }} />
        {offScale ? (
          <span
            className={`distbar-off ${offScale}`}
            style={{ left: offScale === 'high' ? '100%' : '0%' }}
          />
        ) : (
          <span className="distbar-dot" style={{ left: `${at(pos.value)}%` }} />
        )}
      </div>

      <div className="distbar-ends">
        <span>{lowLabel ?? fmt(min)}</span>
        <span>{highLabel ?? fmt(max)}</span>
      </div>

      <div className="distbar-legend">
        <span className="distbar-key">
          {offScale ? <i className={`k-off ${offScale}`} /> : <i className="k-dot" />}이 단지{' '}
          <b className="tabular">{fmt(pos.value)}</b>
          {offScale ? <span className="muted">{' '}(그림 범위 밖)</span> : null}
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

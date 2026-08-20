'use client';

import type { ComplexFacts } from '@/lib/complex-facts';
import DistBar, { type Positioned } from './DistBar';

export type FactsResponse =
  | {
      matched: true;
      window: { from: string; months: number };
      facts: ComplexFacts;
      turnoverLabel: string | null;
      /** 같은 구 분포 안에서의 위치 — 없으면 비교 줄을 접는다 */
      turnover: Positioned | null;
      /** 실거래에서 쪼개져 온 블록 이름들 (합산했을 때만) */
      mergedBlocks: string[] | null;
    }
  | { matched: false; reason: string; complex?: { aptNm: string } };

type Props = {
  data: FactsResponse | null;
  loading: boolean;
  error: string | null;
  /** 비교 대상 지역 이름 (예: 강남구) */
  regionLabel?: string;
};

/** 값이 없으면 아예 줄을 지운다 — "—" 만 늘어놓으면 읽기 나쁘다 */
function Spec({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="spec">
      <span className="k">{label}</span>
      <span className="v tabular">{value}</span>
    </div>
  );
}

export default function FactsCard({ data, loading, error, regionLabel }: Props) {
  if (loading) {
    return (
      <div className="card">
        <h2 className="card-title">단지 정보</h2>
        <p className="card-sub" style={{ marginBottom: 0 }}>
          <span className="spinner" /> 단지 정보를 불러오는 중…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="card-title">단지 정보</h2>
        {/테이블이 없습니다/.test(error) ? (
          <div className="callout">
            <b>단지 정보 테이블이 아직 없습니다.</b>
            <br />
            <code>src/lib/schema.sql</code> 의 <code>apt_kapt</code> · <code>kapt_ingest_log</code>{' '}
            부분을 실행하거나 <code>npm run db:setup</code> 을 다시 돌려주세요.
          </div>
        ) : (
          <div className="callout error">{error}</div>
        )}
      </div>
    );
  }

  if (!data) return null;

  // 데이터가 없는 것은 오류가 아니다 — K-apt 는 의무관리대상만 담는다
  if (!data.matched) {
    if (data.reason === 'memory-mode') return null;
    return (
      <div className="card">
        <h2 className="card-title">단지 정보</h2>
        <div className="callout">
          이 단지는 공동주택관리정보(K-apt)에 없습니다. K-apt 는 <b>의무관리대상</b>(300세대
          이상 등)만 담기 때문에 소규모 단지는 세대수·준공일 정보가 제공되지 않습니다.
        </div>
      </div>
    );
  }

  const f = data.facts;
  const region = regionLabel ?? '같은 구';

  // 준공 3년 이내면 입주장 때문에 회전율이 높게 나온다 — 값이 아니라 해석을 보태야 한다
  const approvedYear = f.approvedAt ? Number(f.approvedAt.slice(0, 4)) : null;
  const yearsOld =
    approvedYear && approvedYear > 1900 ? new Date().getFullYear() - approvedYear : null;
  const isNew = yearsOld != null && yearsOld <= 3;

  return (
    <div className="card">
      <h2 className="card-title">
        단지 정보
        {f.households != null && (
          <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
            {'  '}
            {f.households.toLocaleString('ko-KR')}세대
            {f.dongCnt ? ` · ${f.dongCnt}개 동` : ''}
          </span>
        )}
      </h2>
      <p className="card-sub">
        국토교통부 공동주택관리정보(K-apt)입니다. 아래 <b>회전율</b>과{' '}
        <b>전월세 신고율</b>은 이 세대수를 제가 가진 실거래 기록과 나눠서 낸 값입니다.
      </p>

      {data.mergedBlocks && (
        <div className="callout">
          실거래 자료는 이 단지를 <b>{data.mergedBlocks.join(' · ')}</b> 로 나눠서 보냅니다.
          세대수는 단지 전체 하나뿐이라 조각만 세면 값이 크게 어긋나므로(저층 블록 6건 ÷
          2,064세대 = 0.3% 처럼), 아래 회전율·신고율은 <b>블록을 모두 합쳐</b> 계산했습니다.
          위쪽 거래 내역·예상 시세는 고른 블록만 봅니다.
        </div>
      )}

      <div className="tiles">
        <div className="tile">
          <div className="label">거래 회전율 (1년)</div>
          <div className="value tabular">
            {f.turnoverPct != null ? `${f.turnoverPct}%` : '—'}
          </div>
          <div className="foot">
            {f.saleCount12m}건 / {f.households?.toLocaleString('ko-KR') ?? '—'}세대
            {data.turnoverLabel ? ` · ${data.turnoverLabel}` : ''}
            {data.mergedBlocks ? ` · ${data.mergedBlocks.length}개 블록 합산` : ''}
          </div>
        </div>

        <div className="tile">
          <div className="label">전월세 신고율 (1년)</div>
          <div className="value tabular">
            {f.rentReportPct != null ? `${f.rentReportPct}%` : '—'}
          </div>
          <div className="foot">{f.rentCount12m}건 / 세대수</div>
        </div>

        <div className="tile">
          <div className="label">세대 평균 전용</div>
          <div className="value tabular">
            {f.areaPerHousehold != null ? `${f.areaPerHousehold}㎡` : '—'}
          </div>
          <div className="foot">
            {f.pyeongPerHousehold != null ? `약 ${f.pyeongPerHousehold}평` : '전용면적 미상'}
          </div>
        </div>

        <div className="tile">
          <div className="label">전용률</div>
          <div className="value tabular">
            {f.privRatioPct != null ? `${f.privRatioPct}%` : '—'}
          </div>
          <div className="foot">전용면적 ÷ 연면적</div>
        </div>
      </div>

      {data.turnover && (
        <div className="compare">
          <div className="compare-head">
            회전율은 {region}에서 어디쯤인가
            <span className="muted">
              {' '}
              —{' '}
              {data.turnover.percentile <= 10
                ? `${region}에서 가장 낮은 편`
                : data.turnover.percentile >= 90
                  ? `${region}에서 가장 높은 편`
                  : `${region} 하위 ${data.turnover.percentile}%`}
              {` · 중위의 ${data.turnover.vsMedian}배`}
            </span>
          </div>
          <DistBar
            pos={data.turnover}
            regionLabel={region}
            lowLabel="손바뀜 적음"
            highLabel="손바뀜 활발"
          />
        </div>
      )}

      <div className="spec-grid">
        <Spec label="사용승인일" value={f.approvedAt} />
        <Spec label="난방방식" value={f.heatNm} />
        <Spec label="복도 구조" value={f.hallNm} />
        <Spec label="최고층" value={f.topFloor ? `${f.topFloor}층` : null} />
        <Spec label="승강기" value={f.elevatorCnt ? `${f.elevatorCnt}대` : null} />
        <Spec label="관리방식" value={f.mgrNm} />
        <Spec label="분양형태" value={f.saleNm} />
        <Spec label="시공사" value={f.builder} />
        <Spec label="주소" value={f.roadAddr ?? f.addr} />
      </div>

      <ul className="notes">
        {isNew && (
          <li>
            <b>이 단지는 준공 {yearsOld != null ? `${yearsOld}년차` : '신축'}입니다.</b> 준공
            직후에는 입주·분양권 전매 거래가 몰려서 회전율이 원래 높게 나옵니다 — 손바뀜이
            활발한 동네라는 뜻이 아니라 <b>새 아파트라서</b> 그렇습니다. 실측으로 2024년
            준공 단지가 148세대에 1년 86건(58%)까지 나옵니다.
          </li>
        )}
        <li>
          <b>거래 회전율</b>은 최근 1년 매매 건수를 세대수로 나눈 값입니다. 낮으면 매물이
          잠긴 단지(재건축 대기 등), 높으면 손바뀜이 빠른 단지입니다.
          {data.turnover ? (
            <>
              {' '}
              위의 비교 띠는 <b>{region} 안에서 세대수를 아는 단지 {data.turnover.distribution.count}곳</b>을
              같은 방식으로 계산해 늘어놓은 것입니다. 낮은 게 좋다/나쁘다는 뜻이 아닙니다 —
              재건축을 기다리는 단지는 원래 낮습니다.
            </>
          ) : (
            ' 서울 대단지는 대개 2~5% 구간에 몰립니다.'
          )}
        </li>
        <li>
          <b>전월세 신고율은 임대 비중이 아닙니다.</b> 전월세 계약은 보통 2년이라 매년
          절반쯤만 갱신 신고되고, 갱신 신고가 빠지는 경우도 있습니다. 그래서 임대 비중으로
          환산하지 않고 신고율 그대로 보여줍니다 — 회전율과 나란히 놓고 <b>비교</b>하는
          용도입니다.
        </li>
        <li className="muted">
          세대수·준공일 같은 값은 K-apt 등록 정보라 실제와 다를 수 있고, 소규모 단지는
          아예 등록되지 않습니다.
        </li>
      </ul>
    </div>
  );
}

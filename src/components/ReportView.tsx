import Link from 'next/link';
import { krwShort } from '@/lib/format';
import { cycleLabel, krDate, rollupBySido, type DailyReport } from '@/lib/report';

/**
 * 매일 리포트 본문. `/report`(최신)와 `/report/[date]`(지난 날짜)가 같이 쓴다.
 *
 * **숫자와 변화량만 쓴다.** 해석하는 문장("금리가 내렸으니 지금이 기회")은 넣지
 * 않는다 — 개인화된 투자 조언이라 이 서비스가 하지 않기로 한 것이다. 대신 숫자가
 * 무엇을 뜻하고 **무엇을 뜻하지 않는지**를 적는다.
 *
 * 클라이언트 자바스크립트가 없다. 전부 서버에서 그려 정적 HTML 로 나간다.
 */

/** 평단가 순위에 몇 곳을 보여주나 */
const RANK_LIMIT = 15;
/** 변화 상·하위 각각 몇 곳 */
const MOVER_LIMIT = 5;
/**
 * 변화를 계산할 최소 거래 수.
 *
 * 실측으로 정했다. 15건이면 서울 중구가 **거래 15건으로 +28.1%** 를 차지해 표
 * 맨 위에 오는데, 이건 시장이 움직인 게 아니라 표본이 적어 중위값이 튄 것이다.
 * 20건에서 그 값이 사라지고 30건이면 최대치가 +10.5%(거래 202건)로 안정된다.
 * 대상 지역은 75곳에서 69곳으로 6곳만 준다 — 싼 값에 노이즈를 걷어낸다.
 */
const MIN_MOVE_DEALS = 30;

const pct = (cur: number, prev: number) => ((cur - prev) / prev) * 100;

function Delta({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value == null) return <span className="muted">—</span>;
  const dir = value > 0.05 ? 'up' : value < -0.05 ? 'down' : 'flat';
  // 부호와 화살표를 같이 쓴다 — 색만으로 방향을 알리지 않는다
  const mark = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–';
  // 기존 지역 페이지와 같은 색 규칙을 쓴다 (.delta-up / .delta-down)
  return (
    <span className={dir === 'flat' ? 'muted' : `delta-${dir}`}>
      <span aria-hidden="true">{mark}</span>
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

export default function ReportView({
  report,
  prev,
}: {
  report: DailyReport;
  prev: DailyReport | null;
}) {
  const sido = rollupBySido(report, prev);

  const ranked = report.regions
    .filter((r) => r.ppp != null)
    .sort((a, b) => (b.ppp ?? 0) - (a.ppp ?? 0));

  const movers = report.regions
    .filter((r) => r.ppp != null && r.pppPrev != null && r.deals30 >= MIN_MOVE_DEALS)
    .map((r) => ({ ...r, change: pct(r.ppp as number, r.pppPrev as number) }))
    .sort((a, b) => b.change - a.change);

  const up = movers.slice(0, MOVER_LIMIT);
  // 대상이 10곳 미만이면 위·아래가 겹친다 — 같은 지역이 표에 두 번 나오지 않게 자른다
  const down = movers.slice(Math.max(MOVER_LIMIT, movers.length - MOVER_LIMIT)).reverse();

  const deals30 = report.regions.reduce((s, r) => s + r.deals30, 0);
  const monthsLabel = report.months
    .map((m) => `${Number(m.slice(4, 6))}월`)
    .join('·');

  return (
    <>
      <div className="card">
        <h2 className="card-title">오늘의 숫자</h2>
        <p className="card-sub">
          국토교통부에 <b>신고된</b> 아파트 매매 기준입니다. 계약일이 아니라 신고가 들어온
          시점으로 세기 때문에, 오늘 늘어난 건수에는 몇 주 전 계약도 섞여 있습니다.
        </p>
        <div className="tiles">
          <div className="tile">
            <div className="label">누적 신고</div>
            <div className="value tabular">{report.totals.deals.toLocaleString('ko-KR')}</div>
            <div className="foot">{monthsLabel} 계약분</div>
          </div>
          <div className="tile">
            <div className="label">전일 대비</div>
            <div className="value tabular">
              {report.totals.newDeals == null
                ? '—'
                : `${report.totals.newDeals >= 0 ? '+' : ''}${report.totals.newDeals.toLocaleString('ko-KR')}`}
            </div>
            <div className="foot">
              {report.prevDate ? `${krDate(report.prevDate)} 대비` : '첫 리포트'}
            </div>
          </div>
          <div className="tile">
            <div className="label">최근 30일 거래</div>
            <div className="value tabular">{deals30.toLocaleString('ko-KR')}</div>
            <div className="foot">계약일 기준</div>
          </div>
          <div className="tile">
            <div className="label">집계 지역</div>
            <div className="value tabular">{report.totals.regions}</div>
            <div className="foot">시군구</div>
          </div>
        </div>
      </div>

      {report.rates && report.rates.length > 0 && (
        <div className="card">
          <h2 className="card-title">금리 · 환율</h2>
          <p className="card-sub">
            한국은행 ECOS 핵심지표입니다. <b>기준 시점이 지표마다 다릅니다</b> — 시장금리는
            매일, 예금은행 금리는 매월, 주택가격지수는 몇 달 늦게 갱신됩니다. 각 줄에
            그 지표의 기준 시점을 적었습니다.
          </p>
          <div className="table-wrap">
            <table className="find-table">
              <thead>
                <tr>
                  <th>지표</th>
                  <th className="r">값</th>
                  <th>기준 시점</th>
                </tr>
              </thead>
              <tbody>
                {report.rates.map((r) => (
                  <tr key={r.name}>
                    <td>
                      {r.name}
                      <span className="sub">{r.group}</span>
                    </td>
                    <td className="r tabular">
                      <b>{r.value.toLocaleString('ko-KR')}</b>
                      <span className="sub">{r.unit}</span>
                    </td>
                    <td className="muted">{cycleLabel(r.cycle)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">시도별</h2>
        <p className="card-sub">
          평단가는 그 시도에 속한 <b>시군구 중위값들의 중위값</b>입니다. 지역 크기를 무시한
          값이라 시도끼리 견주는 용도이고, 그 시도의 평균 가격은 아닙니다.
        </p>
        <div className="table-wrap">
          <table className="find-table">
            <thead>
              <tr>
                <th>시도</th>
                <th className="r">누적 신고</th>
                <th className="r">전일 대비</th>
                <th className="r">평단가 중위</th>
              </tr>
            </thead>
            <tbody>
              {sido.map((s) => (
                <tr key={s.sido}>
                  <td>
                    {s.sido}
                    <span className="sub">{s.regions}개 시군구</span>
                  </td>
                  <td className="r tabular">{s.deals.toLocaleString('ko-KR')}건</td>
                  <td className="r tabular">
                    {s.newDeals == null
                      ? '—'
                      : `${s.newDeals >= 0 ? '+' : ''}${s.newDeals.toLocaleString('ko-KR')}`}
                  </td>
                  <td className="r tabular">
                    {s.pppMedian == null ? '—' : `${s.pppMedian.toLocaleString('ko-KR')}만`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">평단가 상위 시군구</h2>
        <p className="card-sub">
          최근 30일 실거래를 전용 평당 금액으로 바꿔 줄 세운 중위값입니다. 거래{' '}
          {MIN_MOVE_DEALS}건 미만인 지역은 변화율을 비우고, 10건 미만이면 평단가 자체를
          내지 않습니다.
        </p>
        <div className="table-wrap">
          <table className="find-table">
            <thead>
              <tr>
                <th>시군구</th>
                <th className="r">평단가</th>
                <th className="r">직전 30일 대비</th>
                <th className="r">거래</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, RANK_LIMIT).map((r, i) => (
                <tr key={r.lawdCd}>
                  <td>
                    <span className="muted tabular">{i + 1}. </span>
                    <Link className="link" href={`/region/${r.lawdCd}`}>
                      {r.name}
                    </Link>
                    <span className="sub">{r.sido}</span>
                  </td>
                  <td className="r tabular">
                    <b>{(r.ppp as number).toLocaleString('ko-KR')}만</b>
                    <span className="sub">평당</span>
                  </td>
                  <td className="r tabular">
                    <Delta
                      value={
                        r.pppPrev != null && r.deals30 >= MIN_MOVE_DEALS
                          ? pct(r.ppp as number, r.pppPrev)
                          : null
                      }
                    />
                  </td>
                  <td className="r tabular">{r.deals30}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {up.length > 0 && (
        <div className="card">
          <h2 className="card-title">30일 사이 많이 움직인 시군구</h2>
          <p className="card-sub">
            최근 30일 중위 평단가를 <b>직전 30일</b>과 견준 값입니다. 같은 집의 가격 변화가
            아니라 <b>어느 집이 거래됐는지</b>가 바뀐 결과일 수 있습니다 — 큰 평형이 몇 건
            더 팔리면 그것만으로 중위값이 올라갑니다. 방향을 읽는 용도로만 보세요.
          </p>
          <div className="table-wrap">
            <table className="find-table">
              <thead>
                <tr>
                  <th>시군구</th>
                  <th className="r">평단가</th>
                  <th className="r">변화</th>
                  <th className="r">거래</th>
                </tr>
              </thead>
              <tbody>
                {[...up, ...down].map((r, i) => (
                  <tr key={`${r.lawdCd}-${i}`}>
                    <td>
                      <Link className="link" href={`/region/${r.lawdCd}`}>
                        {r.name}
                      </Link>
                      <span className="sub">{r.sido}</span>
                    </td>
                    <td className="r tabular">{(r.ppp as number).toLocaleString('ko-KR')}만</td>
                    <td className="r tabular">
                      <Delta value={r.change} />
                    </td>
                    <td className="r tabular">{r.deals30}건</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.topDeals.length > 0 && (
        <div className="card">
          <h2 className="card-title">
            이달 평단가 상위 거래
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {'  '}
              {Number(report.months[report.months.length - 1].slice(4, 6))}월 계약분
            </span>
          </h2>
          <p className="card-sub">
            전용면적당 금액이 높은 순입니다. <b>총액이 큰 순이 아닙니다</b> — 작은 평형이
            위에 올 수 있으니 전용면적을 같이 보세요.
          </p>
          <div className="table-wrap">
            <table className="find-table">
              <thead>
                <tr>
                  <th>단지</th>
                  <th className="r">평단가</th>
                  <th className="r">거래금액</th>
                  <th className="r">전용</th>
                  <th className="r">계약</th>
                </tr>
              </thead>
              <tbody>
                {report.topDeals.map((d, i) => (
                  <tr key={`${d.aptSeq}-${d.dealDate}-${i}`}>
                    <td>
                      <Link className="link" href={`/apt/${encodeURIComponent(d.aptSeq)}`}>
                        {d.aptNm}
                      </Link>
                      <span className="sub">
                        {d.regionLabel} {d.umdNm}
                      </span>
                    </td>
                    <td className="r tabular">
                      <b>{d.ppp.toLocaleString('ko-KR')}만</b>
                      <span className="sub">평당</span>
                    </td>
                    <td className="r tabular">{krwShort(d.amount)}</td>
                    <td className="r tabular">
                      {d.area}㎡<span className="sub">{d.pyeong}평</span>
                    </td>
                    <td className="r tabular">
                      {d.dealDate.slice(5)}
                      <span className="sub">{d.floor == null ? '—' : `${d.floor}층`}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <ul className="notes">
          <li>
            국토교통부 실거래 신고 자료입니다. 신고 기한이 계약일로부터 30일이라{' '}
            <b>최근 한두 달은 아직 덜 차 있습니다</b> — 이달 건수가 지난달보다 적은 것은
            거래가 줄어서가 아니라 아직 신고가 안 들어와서일 수 있습니다. 해제된 거래는
            제외했습니다.
          </li>
          <li>
            집계 대상은 이 서비스가 실거래를 담아둔 {report.totals.regions}개 시군구입니다.
            전국 전체가 아닙니다.
          </li>
          <li className="muted">
            지난 실거래 기록이고 현재 매물 가격이 아닙니다. 이 리포트는 사실과 변화량만
            담으며 매수·매도 판단을 권하지 않습니다. 참고용으로만 보세요.
          </li>
          <li className="muted">
            생성 {new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC
            {report.rates ? ' · 금리 자료 한국은행 ECOS' : ''}
          </li>
        </ul>
      </div>
    </>
  );
}

/** 지난 리포트 목록 — 크롤러가 과거 리포트로 걸어가는 길이기도 하다 */
export function ReportArchive({ dates, current }: { dates: string[]; current: string }) {
  if (dates.length <= 1) return null;
  return (
    <div className="card">
      <h2 className="card-title">지난 리포트</h2>
      <div className="region-links">
        {dates
          .filter((d) => d !== current)
          .slice(0, 60)
          .map((d) => (
            <Link key={d} href={`/report/${d}`}>
              {krDate(d)}
            </Link>
          ))}
      </div>
    </div>
  );
}

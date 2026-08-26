import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import LongTermChart from '@/components/LongTermChart';
import { loadComplexPage } from '@/lib/complex-page';
import { krwShort, shortDate } from '@/lib/format';
import { siteUrl } from '@/lib/site-url';

/**
 * /apt/[aptSeq] — 단지별 실거래가 페이지 (검색 노출용)
 *
 * 첫 화면은 주소가 하나뿐이어서 "은마 실거래가" 같은 검색어에 걸릴 페이지가 없었다.
 * 이 페이지가 그 자리를 메운다.
 *
 * **미리 만들지 않는다.** 거래 3건 이상 단지가 8,649개인데 빌드 때 다 그리면
 * 한 장에 1~2초씩 걸려 두 시간이 넘는다. 그래서 첫 요청에 만들고(ISR) 하루 동안
 * 캐시한다 — 실거래 신고는 하루 단위로 들어오니 하루가 맞다.
 *
 * **예상 시세(회귀 추정)는 넣지 않는다.** 지역 전체 거래가 있어야 나오는 값이라
 * 이 페이지에서 만들 수 없고, 더 약한 방법으로 비슷한 숫자를 내어 같은 것처럼
 * 보여주면 안 된다. 사실만 담고 추정은 앱으로 넘긴다.
 */

export const revalidate = 86400;
export const dynamicParams = true;

/** 빈 배열 = 빌드 때 아무것도 미리 만들지 않는다 (위 주석 참고) */
export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ aptSeq: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { aptSeq } = await params;
  const d = await loadComplexPage(decodeURIComponent(aptSeq));
  if (!d) return { title: '단지를 찾을 수 없습니다', robots: { index: false, follow: false } };

  const top = d.areas[0];
  const title = `${d.aptNm} 실거래가 · 시세 (${d.regionName} ${d.umdNm})`;
  const description = top
    ? `${d.regionLabel} ${d.umdNm} ${d.aptNm} 최근 1년 실거래 ${d.deals12m}건. 전용 ${top.area}㎡(${top.pyeong}평) 중위 ${krwShort(top.price)}, 평당 ${top.pricePerPyeong.toLocaleString('ko-KR')}만원.${d.buildYear ? ` ${d.buildYear}년 준공.` : ''}${d.facts?.households ? ` ${d.facts.households.toLocaleString('ko-KR')}세대.` : ''} 국토교통부 실거래 신고 자료.`
    : `${d.regionLabel} ${d.umdNm} ${d.aptNm} 실거래가와 시세.`;

  return {
    title,
    description,
    alternates: { canonical: `/apt/${encodeURIComponent(d.aptSeq)}` },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/apt/${encodeURIComponent(d.aptSeq)}`,
      type: 'article',
    },
  };
}

export default async function AptPage({ params }: Props) {
  const { aptSeq } = await params;
  const d = await loadComplexPage(decodeURIComponent(aptSeq));
  if (!d) notFound();

  /**
   * 구조화 데이터 — **사실만.** 가격은 넣지 않는다. schema.org 의 가격 항목은
   * "지금 이 값에 판다" 는 매물 정보인데, 여기 숫자는 지난 실거래 기록이다.
   * 매물처럼 표시하면 거짓이 된다.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: d.aptNm,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'KR',
      addressRegion: d.regionLabel,
      streetAddress: `${d.umdNm}${d.jibun ? ` ${d.jibun}` : ''}`,
    },
    ...(d.buildYear ? { yearBuilt: d.buildYear } : {}),
    ...(d.facts?.households ? { numberOfAccommodationUnits: d.facts.households } : {}),
    url: `${siteUrl}/apt/${encodeURIComponent(d.aptSeq)}`,
  };

  return (
    <div className="page">
      <nav className="crumb" aria-label="위치">
        <Link href="/">아파트 실거래가</Link>
        <span aria-hidden="true"> › </span>
        <Link href={`/region/${d.lawdCd}`}>{d.regionLabel}</Link>
        <span aria-hidden="true"> › </span>
        <span>{d.aptNm}</span>
      </nav>

      <header className="masthead">
        <h1>{d.aptNm} 실거래가</h1>
        <span className="sub">
          {d.regionLabel} {d.umdNm}
          {d.jibun ? ` ${d.jibun}` : ''}
          {d.buildYear ? ` · ${d.buildYear}년 준공` : ''}
          {d.facts?.households ? ` · ${d.facts.households.toLocaleString('ko-KR')}세대` : ''}
        </span>
      </header>

      <div className="card">
        <h2 className="card-title">평형별 최근 1년 실거래 · {d.deals12m}건</h2>
        <p className="card-sub">
          국토교통부에 신고된 실제 거래입니다. <b>중위</b>는 금액순으로 줄 세운 가운데
          값이고, 옆의 범위는 가운데 절반(하위 25%~상위 25%)입니다 — 같은 평형이라도
          층·향에 따라 벌어지는 폭을 함께 봐야 합니다.
        </p>
        <div className="table-wrap">
          <table className="find-table">
            <thead>
              <tr>
                <th>전용</th>
                <th className="r">중위 실거래</th>
                <th className="r">가운데 절반</th>
                <th className="r">평단가</th>
                <th className="r">거래</th>
              </tr>
            </thead>
            <tbody>
              {d.areas.map((a) => (
                <tr key={a.area}>
                  <td>
                    <b>{a.pyeong}평</b>
                    <span className="sub">
                      {a.areaMax - a.areaMin > 0.05
                        ? `${a.areaMin}~${a.areaMax}㎡`
                        : `${a.area}㎡`}
                    </span>
                  </td>
                  <td className="r tabular">
                    <b>{krwShort(a.price)}</b>
                  </td>
                  <td className="r tabular">
                    {krwShort(a.low)}~{krwShort(a.high)}
                  </td>
                  <td className="r tabular">
                    {a.pricePerPyeong.toLocaleString('ko-KR')}만
                    <span className="sub">평당</span>
                  </td>
                  <td className="r tabular">
                    {a.deals}건<span className="sub">{shortDate(a.lastDeal)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="callout" style={{ marginTop: 14 }}>
          <b>층·면적을 보정한 예상 시세와 예측 구간</b>은 조회 화면에서 계산합니다 — 지역
          가격지수로 시점까지 맞춘 값입니다. <Link href="/">조회 화면으로 가기</Link>
        </div>
      </div>

      {d.facts && (
        <div className="card">
          <h2 className="card-title">단지 정보</h2>
          <div className="spec-grid">
            {d.facts.households != null && (
              <div className="spec">
                <span className="k">세대수</span>
                <span className="v tabular">
                  {d.facts.households.toLocaleString('ko-KR')}세대
                </span>
              </div>
            )}
            {d.facts.dongCnt != null && (
              <div className="spec">
                <span className="k">동수</span>
                <span className="v tabular">{d.facts.dongCnt}개 동</span>
              </div>
            )}
            {d.facts.approvedAt && (
              <div className="spec">
                <span className="k">사용승인일</span>
                <span className="v tabular">{d.facts.approvedAt}</span>
              </div>
            )}
            {d.facts.heatNm && (
              <div className="spec">
                <span className="k">난방방식</span>
                <span className="v">{d.facts.heatNm}</span>
              </div>
            )}
            {d.facts.hallNm && (
              <div className="spec">
                <span className="k">복도 구조</span>
                <span className="v">{d.facts.hallNm}</span>
              </div>
            )}
            {d.facts.builder && (
              <div className="spec">
                <span className="k">시공사</span>
                <span className="v">{d.facts.builder}</span>
              </div>
            )}
          </div>

          {(d.turnover || d.jeonseRatio) && (
            <ul className="notes">
              {d.turnover && (
                <li>
                  <b>거래 회전율 {d.turnover.value}%</b> — 최근 1년 매매를 세대수로 나눈
                  값입니다. {d.regionName} 중위는 {d.turnover.distribution.median}% 이고 이
                  단지는{' '}
                  {d.turnover.percentile <= 10
                    ? '가장 낮은 편'
                    : d.turnover.percentile >= 90
                      ? '가장 높은 편'
                      : `하위 ${d.turnover.percentile}%`}
                  입니다. 낮으면 매물이 잠긴 단지(재건축 대기 등), 높으면 손바뀜이 빠른
                  단지입니다 — 어느 쪽이 좋다는 뜻은 아닙니다.
                </li>
              )}
              {d.jeonseRatio && (
                <li>
                  <b>전세가율 {d.jeonseRatio.value}%</b> — 같은 평형 중위 전세 ÷ 중위
                  매매입니다. {d.regionName} 중위는 {d.jeonseRatio.distribution.median}%
                  입니다.
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {d.longTerm.length >= 6 && (
        <div className="card">
          <h2 className="card-title">
            {d.regionLabel} 장기 흐름
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {'  '}
              {Math.round(d.longTerm.length / 12)}년
            </span>
          </h2>
          <p className="card-sub">
            이 단지가 아니라 <b>{d.regionName} 전체</b>의 월별 전용 평단가 중위값입니다.
            어느 동네가 거래됐는지에 흔들리므로 동네 수준을 보는 용도입니다.
          </p>
          <LongTermChart
            points={d.longTerm.map((r) => ({
              ym: r.dealYm,
              ppp: r.pppMedian,
              p25: r.pppP25,
              p75: r.pppP75,
              deals: r.deals,
            }))}
            regionName={d.regionName}
          />
        </div>
      )}

      <div className="card">
        <h2 className="card-title">최근 거래 내역</h2>
        <div className="table-wrap">
          <table className="find-table">
            <thead>
              <tr>
                <th>계약일</th>
                <th className="r">전용</th>
                <th className="r">층</th>
                <th className="r">거래금액</th>
                <th>유형</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((t, i) => (
                <tr key={`${t.dealDate}-${t.area}-${t.floor}-${i}`}>
                  <td className="tabular">{t.dealDate}</td>
                  <td className="r tabular">{t.area}㎡</td>
                  <td className="r tabular">{t.floor ?? '—'}</td>
                  <td className="r tabular">
                    <b>{krwShort(t.amount)}</b>
                  </td>
                  <td>{t.dealingGbn ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="notes">
          <li>
            국토교통부 실거래 신고 자료입니다. 신고 기한이 계약일로부터 30일이라 최근
            한두 달은 아직 덜 차 있습니다. 해제된 거래는 제외했습니다.
          </li>
          <li className="muted">
            여기 숫자는 <b>지난 실거래 기록</b>이고 현재 매물 가격이 아닙니다.
            학군·교통·재건축 단계는 반영되지 않았습니다. 참고용으로만 보세요.
          </li>
        </ul>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}

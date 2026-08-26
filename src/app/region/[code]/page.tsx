import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import LongTermChart from '@/components/LongTermChart';
import { krwShort } from '@/lib/format';
import { ingestedRegions, loadRegionPage } from '@/lib/region-page';
import { siteUrl } from '@/lib/site-url';

/**
 * /region/[code] — 시군구별 실거래가 페이지 (검색 노출용)
 *
 * 하는 일이 둘이다:
 *  1. "강남구 아파트 실거래가" 같은 검색어를 받는다
 *  2. **단지 페이지로 가는 길을 만든다** — 크롤러는 링크를 따라 걷는다.
 *     사이트맵만 있고 링크가 없으면 발견이 느리고 페이지 사이 관계도 안 읽힌다.
 *
 * 지역은 83개뿐이라 **빌드 때 미리 만든다.** 단지 페이지(8,649개)와 다르다.
 */

export const revalidate = 86400;
export const dynamicParams = true;

export async function generateStaticParams() {
  try {
    return (await ingestedRegions()).map((code) => ({ code }));
  } catch {
    // DB 를 못 읽어도 빌드는 되게 둔다 — 첫 요청에 만들어진다
    return [];
  }
}

type Props = { params: Promise<{ code: string }> };

/** 링크로 걸어 줄 단지 수. 너무 많으면 목록이 읽히지 않고, 적으면 크롤러가 못 걷는다 */
const LINK_LIMIT = 120;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const d = await loadRegionPage(code);
  if (!d) return { title: '지역을 찾을 수 없습니다', robots: { index: false, follow: false } };

  const title = `${d.name} 아파트 실거래가 · 시세`;
  const description = `${d.label} 최근 1년 아파트 실거래 ${d.deals12m.toLocaleString('ko-KR')}건. 전용 평당 중위 ${d.pppMedian.toLocaleString('ko-KR')}만원(가운데 절반 ${d.pppP25.toLocaleString('ko-KR')}~${d.pppP75.toLocaleString('ko-KR')}만원). 단지 ${d.complexes.length.toLocaleString('ko-KR')}곳의 실거래 기록. 국토교통부 신고 자료.`;

  return {
    title,
    description,
    alternates: { canonical: `/region/${d.lawdCd}` },
    openGraph: { title, description, url: `${siteUrl}/region/${d.lawdCd}`, type: 'article' },
  };
}

export default async function RegionPage({ params }: Props) {
  const { code } = await params;
  const d = await loadRegionPage(code);
  if (!d) notFound();

  const linked = d.complexes.slice(0, LINK_LIMIT);

  return (
    <div className="page">
      <nav className="crumb" aria-label="위치">
        <Link href="/">아파트 실거래가</Link>
        <span aria-hidden="true"> › </span>
        <span>{d.label}</span>
      </nav>

      <header className="masthead">
        <h1>{d.name} 아파트 실거래가</h1>
        <span className="sub">
          {d.sido} · 최근 1년 {d.deals12m.toLocaleString('ko-KR')}건 · 단지{' '}
          {d.complexes.length.toLocaleString('ko-KR')}곳
        </span>
      </header>

      <div className="card">
        <h2 className="card-title">{d.name} 전용 평단가</h2>
        <p className="card-sub">
          최근 1년 실거래를 평당 금액으로 바꿔 줄 세운 값입니다. <b>가운데 절반</b>이 넓으면
          그 구 안에서도 동네·단지에 따라 값이 크게 갈린다는 뜻입니다.
        </p>
        <div className="tiles">
          <div className="tile">
            <div className="label">중위 평단가</div>
            <div className="value tabular">{d.pppMedian.toLocaleString('ko-KR')}만</div>
            <div className="foot">평당 · 전용면적 기준</div>
          </div>
          <div className="tile">
            <div className="label">가운데 절반</div>
            <div className="value tabular" style={{ fontSize: 20 }}>
              {d.pppP25.toLocaleString('ko-KR')}~{d.pppP75.toLocaleString('ko-KR')}
            </div>
            <div className="foot">하위 25% ~ 상위 25%</div>
          </div>
          <div className="tile">
            <div className="label">거래 건수</div>
            <div className="value tabular">{d.deals12m.toLocaleString('ko-KR')}</div>
            <div className="foot">최근 1년</div>
          </div>
          <div className="tile">
            <div className="label">거래된 단지</div>
            <div className="value tabular">{d.complexes.length.toLocaleString('ko-KR')}</div>
            <div className="foot">최근 1년 기준</div>
          </div>
        </div>
      </div>

      {d.longTerm.length >= 6 && (
        <div className="card">
          <h2 className="card-title">
            장기 흐름
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {'  '}
              {Math.round(d.longTerm.length / 12)}년
            </span>
          </h2>
          <p className="card-sub">
            그 달에 <b>실제로 거래된</b> 전용 평단가의 중위값입니다. 어느 동네가 거래됐는지에
            흔들리므로 동네 수준을 보는 용도입니다.
          </p>
          <LongTermChart
            points={d.longTerm.map((r) => ({
              ym: r.dealYm,
              ppp: r.pppMedian,
              p25: r.pppP25,
              p75: r.pppP75,
              deals: r.deals,
            }))}
            regionName={d.name}
          />
        </div>
      )}

      {d.dongs.length > 1 && (
        <div className="card">
          <h2 className="card-title">법정동별 거래</h2>
          <div className="table-wrap">
            <table className="find-table">
              <thead>
                <tr>
                  <th>법정동</th>
                  <th className="r">거래</th>
                  <th className="r">중위 평단가</th>
                </tr>
              </thead>
              <tbody>
                {d.dongs.slice(0, 30).map((x) => (
                  <tr key={x.umdNm}>
                    <td>{x.umdNm}</td>
                    <td className="r tabular">{x.deals.toLocaleString('ko-KR')}건</td>
                    <td className="r tabular">{x.pppMedian.toLocaleString('ko-KR')}만</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">
          거래가 많은 단지
          {d.complexes.length > LINK_LIMIT && (
            <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
              {'  '}
              {d.complexes.length.toLocaleString('ko-KR')}곳 중 {LINK_LIMIT}곳
            </span>
          )}
        </h2>
        <p className="card-sub">
          단지 이름을 누르면 그 단지의 평형별 실거래가와 거래 내역을 봅니다. 금액은{' '}
          <b>최근 1년 중위 실거래가</b>이고, 단지 안 여러 평형이 섞인 값이라 단지 페이지에서
          평형별로 나눠 보셔야 정확합니다.
        </p>
        <div className="table-wrap">
          <table className="find-table">
            <thead>
              <tr>
                <th>단지</th>
                <th className="r">중위 실거래</th>
                <th className="r">평단가</th>
                <th className="r">거래</th>
              </tr>
            </thead>
            <tbody>
              {linked.map((c) => (
                <tr key={c.aptSeq}>
                  <td>
                    <Link className="link" href={`/apt/${encodeURIComponent(c.aptSeq)}`}>
                      {c.aptNm}
                    </Link>
                    <span className="sub">
                      {c.umdNm}
                      {c.buildYear ? ` · ${c.buildYear}년` : ''}
                    </span>
                  </td>
                  <td className="r tabular">
                    <b>{krwShort(c.price)}</b>
                    <span className="sub">평균 {c.pyeong}평</span>
                  </td>
                  <td className="r tabular">
                    {c.pricePerPyeong.toLocaleString('ko-KR')}만<span className="sub">평당</span>
                  </td>
                  <td className="r tabular">{c.deals}건</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="notes">
          <li>
            국토교통부 실거래 신고 자료입니다. 신고 기한이 계약일로부터 30일이라 최근 한두
            달은 아직 덜 차 있습니다. 해제된 거래는 제외했습니다.
          </li>
          <li>
            <b>층·면적을 보정한 예상 시세</b>와 조건별 단지 찾기는 조회 화면에서 씁니다.{' '}
            <Link href="/">조회 화면으로 가기</Link>
          </li>
          <li className="muted">
            지난 실거래 기록이고 현재 매물 가격이 아닙니다. 학군·교통·재건축 단계는
            반영되지 않았습니다. 참고용으로만 보세요.
          </li>
        </ul>
      </div>
    </div>
  );
}

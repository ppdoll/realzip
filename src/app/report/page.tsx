import type { Metadata } from 'next';
import Link from 'next/link';
import ReportView, { ReportArchive } from '@/components/ReportView';
import { krDate, loadReport, reportDates } from '@/lib/report';
import { siteUrl } from '@/lib/site-url';

/**
 * /report — 가장 최근 리포트
 *
 * **DB 를 읽지 않는다.** 자료는 `content/reports/*.json` 파일이고, 파일은 커밋으로만
 * 바뀐다. 커밋이 곧 배포이므로 빌드 때 한 번 읽어 정적으로 굳혀도 항상 최신이다.
 * 그래서 revalidate 가 필요 없다 — 되살릴 바깥 자료가 없다.
 *
 * 날짜별 주소(`/report/[date]`)와 내용이 겹친다. 사람은 "오늘 리포트"를 이 주소로
 * 찾고 검색엔진은 날짜별 주소를 색인하므로 둘 다 필요하다. 각자 자기 자신을
 * canonical 로 두고, 이 페이지에는 그날 날짜 주소로 가는 링크를 놓는다.
 */

export const dynamic = 'force-static';

export async function generateMetadata(): Promise<Metadata> {
  const dates = reportDates();
  const latest = dates[0];
  if (!latest) {
    return { title: '매일 부동산 리포트', robots: { index: false, follow: true } };
  }
  const r = loadReport(latest);
  const title = `매일 부동산 리포트 · ${krDate(latest)}`;
  const description = r
    ? `${krDate(latest)} 아파트 실거래 신고 ${r.totals.deals.toLocaleString('ko-KR')}건${r.totals.newDeals != null ? `(전일 대비 ${r.totals.newDeals >= 0 ? '+' : ''}${r.totals.newDeals.toLocaleString('ko-KR')}건)` : ''}. 시군구 ${r.totals.regions}곳 평단가 순위와 변화${r.rates ? ', 한국은행 기준금리·국고채·환율' : ''}. 국토교통부 실거래 신고 자료.`
    : '아파트 실거래와 금리를 매일 정리합니다.';

  return {
    title,
    description,
    alternates: { canonical: '/report' },
    openGraph: { title, description, url: `${siteUrl}/report`, type: 'article' },
  };
}

export default function ReportLatestPage() {
  const dates = reportDates();
  const latest = dates[0];
  const report = latest ? loadReport(latest) : null;

  if (!report) {
    return (
      <div className="page">
        <nav className="crumb" aria-label="위치">
          <Link href="/">아파트 실거래가</Link>
          <span aria-hidden="true"> › </span>
          <span>매일 리포트</span>
        </nav>
        <header className="masthead">
          <h1>매일 부동산 리포트</h1>
        </header>
        <div className="card">
          <p className="card-sub">
            아직 리포트가 없습니다. 매일 아침 실거래 신고와 금리를 정리해 이 자리에
            올립니다. <Link href="/">조회 화면으로 가기</Link>
          </p>
        </div>
      </div>
    );
  }

  const prev = report.prevDate ? loadReport(report.prevDate) : null;

  return (
    <div className="page">
      <nav className="crumb" aria-label="위치">
        <Link href="/">아파트 실거래가</Link>
        <span aria-hidden="true"> › </span>
        <span>매일 리포트</span>
      </nav>

      <header className="masthead">
        <h1>매일 부동산 리포트</h1>
        <span className="sub">
          {krDate(report.date)} · 이 주소는 늘 가장 최근 리포트를 보여줍니다 ·{' '}
          <Link href={`/report/${report.date}`}>이 날짜로 고정된 주소</Link>
        </span>
      </header>

      <ReportView report={report} prev={prev} />
      <ReportArchive dates={dates} current={report.date} />
    </div>
  );
}

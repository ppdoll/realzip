import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ReportView, { ReportArchive } from '@/components/ReportView';
import { krDate, loadReport, reportDates } from '@/lib/report';
import { siteUrl } from '@/lib/site-url';

/**
 * /report/[date] — 그 날짜의 리포트 (지난 기록)
 *
 * **전부 미리 만들고 `dynamicParams` 를 끈다.** 자료가 저장소 안의 파일이라
 * 런타임에 읽으려면 서버리스 번들에 그 파일들이 들어가야 하는데 그건 보장할 수
 * 없다. 리포트가 새로 생기는 순간은 커밋이고 커밋은 곧 배포이므로, 미리 만드는
 * 것만으로 항상 최신이다. 없는 날짜는 404 가 맞다.
 *
 * 장당 비용은 지역 페이지와 다르다 — DB 를 안 읽고 파일만 읽으므로 훨씬 싸다.
 * 그래도 하루에 한 장씩 늘어나므로 빌드 시간이 언젠가 문제가 되면 그때
 * `outputFileTracingIncludes` 로 파일을 번들에 넣고 오래된 날짜를 ISR 로 돌리면 된다.
 */

export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return reportDates().map((date) => ({ date }));
}

type Props = { params: Promise<{ date: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { date } = await params;
  const r = loadReport(date);
  if (!r) return { title: '리포트를 찾을 수 없습니다', robots: { index: false, follow: false } };

  const title = `${krDate(date)} 부동산 리포트 · 실거래와 금리`;
  const description = `${krDate(date)} 기준 아파트 실거래 신고 ${r.totals.deals.toLocaleString('ko-KR')}건${r.totals.newDeals != null ? `(전일 대비 ${r.totals.newDeals >= 0 ? '+' : ''}${r.totals.newDeals.toLocaleString('ko-KR')}건)` : ''}. 시군구 ${r.totals.regions}곳 평단가 순위와 30일 변화${r.rates ? ', 한국은행 기준금리·국고채·환율' : ''}. 국토교통부 실거래 신고 자료.`;

  return {
    title,
    description,
    alternates: { canonical: `/report/${date}` },
    openGraph: { title, description, url: `${siteUrl}/report/${date}`, type: 'article' },
  };
}

export default async function ReportDatePage({ params }: Props) {
  const { date } = await params;
  const report = loadReport(date);
  if (!report) notFound();

  const dates = reportDates();
  const prev = report.prevDate ? loadReport(report.prevDate) : null;
  const isLatest = dates[0] === date;

  return (
    <div className="page">
      <nav className="crumb" aria-label="위치">
        <Link href="/">아파트 실거래가</Link>
        <span aria-hidden="true"> › </span>
        <Link href="/report">매일 리포트</Link>
        <span aria-hidden="true"> › </span>
        <span>{krDate(date)}</span>
      </nav>

      <header className="masthead">
        <h1>{krDate(date)} 부동산 리포트</h1>
        <span className="sub">
          {isLatest ? '가장 최근 리포트입니다' : '지난 리포트입니다 — 이후 신고로 숫자가 바뀌었습니다'}
          {' · '}
          <Link href="/report">최신 리포트 보기</Link>
        </span>
      </header>

      <ReportView report={report} prev={prev} />
      <ReportArchive dates={dates} current={date} />
    </div>
  );
}

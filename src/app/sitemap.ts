import type { MetadataRoute } from 'next';
import { tradedComplexes } from '@/lib/complex-page';
import { ingestedRegions } from '@/lib/region-page';
import { reportDates } from '@/lib/report';
import { siteUrl } from '@/lib/site-url';

/**
 * /sitemap.xml
 *
 * 첫 화면 + 지역(83) + 단지 페이지를 담는다. 한 파일 상한이 50,000 URL 이라
 * 지금 규모(약 8,700)는 한 파일에 들어간다.
 *
 * **단지는 최근 1년 거래 3건 이상만 넣는다.** 1~2건인 단지도 페이지는 열리지만
 * 사이트맵에 넣지 않는다 — 거래 한 건짜리 페이지를 수천 개 올리면 검색엔진이
 * 사이트 전체를 얇게 보고 낮게 평가한다. 실측으로 거래가 있는 단지 11,676곳 중
 * 3건 이상이 8,649곳이다.
 *
 * DB 를 못 읽으면 첫 화면만 담고 끝낸다 — 사이트맵이 아예 없는 것보다 낫고,
 * 빌드를 실패시킬 이유도 없다.
 */

/** 사이트맵에 넣을 최소 거래 건수 */
const MIN_DEALS = 3;

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const home: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${siteUrl}/report`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
  ];

  /**
   * 리포트는 파일이라 DB 와 무관하다 — try 밖에서 담는다. DB 가 죽어도
   * 리포트 주소는 사이트맵에 남아야 한다.
   */
  const reports: MetadataRoute.Sitemap = reportDates().map((date) => ({
    url: `${siteUrl}/report/${date}`,
    lastModified: new Date(`${date}T00:00:00Z`),
    // 지난 리포트는 다시 바뀌지 않는다
    changeFrequency: 'never' as const,
    priority: 0.5,
  }));

  try {
    const [regions, complexes] = await Promise.all([
      ingestedRegions(),
      tradedComplexes({ minDeals: MIN_DEALS }),
    ]);
    return [
      ...home,
      ...reports,
      ...regions.map((code) => ({
        url: `${siteUrl}/region/${code}`,
        lastModified: now,
        changeFrequency: 'daily' as const,
        priority: 0.8,
      })),
      ...complexes.map(({ aptSeq }) => ({
        url: `${siteUrl}/apt/${encodeURIComponent(aptSeq)}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      })),
    ];
  } catch {
    return [...home, ...reports];
  }
}

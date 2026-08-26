import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * /sitemap.xml
 *
 * **지금은 첫 화면 하나뿐이다.** 모든 조회가 클라이언트 상태로만 이뤄져서
 * 단지나 지역에 해당하는 주소가 아직 없다 — 크롤러가 읽는 본문이 474자,
 * 그중 대부분이 시도·시군구 드롭다운 목록이다.
 *
 * 지역·단지별 주소를 만들면(계획: /region/[code] 83개, /apt/[aptSeq] 10,941개)
 * 여기에 함께 넣는다. 한 파일 상한이 50,000 URL 이라 11,025개는 한 파일에 들어간다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${siteUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
  ];
}

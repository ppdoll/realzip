import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site-url';

/**
 * /robots.txt
 *
 * API 경로는 막는다. 색인해서 쓸모가 없는데 크롤러가 훑으면 그때마다 DB 를
 * 두드리고(지역 하나에 수만 행) 크롤링 예산도 거기서 소진된다.
 *
 * 그 밖에는 전부 허용한다. 이 사이트는 공개 데이터를 보여주는 곳이라 감출 것이 없다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}

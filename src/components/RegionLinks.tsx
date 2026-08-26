import Link from 'next/link';
import { regionsBySido } from '@/data/regions';
import { ingestedRegions } from '@/lib/region-page';

/**
 * 첫 화면 아래에 지역 페이지 링크를 깔아 둔다.
 *
 * 사이트맵만으로도 발견은 되지만, **크롤러는 링크를 따라 걷는다** — 링크가 없으면
 * 발견이 느리고 페이지 사이 관계(첫 화면 → 지역 → 단지)도 읽히지 않는다.
 * 사람에게도 쓸모가 있다: 조회 없이 바로 그 구 시세를 볼 수 있다.
 *
 * 담아둔 지역만 넣는다. 없는 지역으로 보내면 404 가 늘고 크롤링 예산이 샌다.
 */
export default async function RegionLinks() {
  let codes: string[] = [];
  try {
    codes = await ingestedRegions();
  } catch {
    return null; // DB 를 못 읽으면 이 블록만 빠진다
  }
  if (codes.length === 0) return null;

  const have = new Set(codes);
  const groups = regionsBySido()
    .map((g) => ({ sido: g.sido, regions: g.regions.filter((r) => have.has(r.code)) }))
    .filter((g) => g.regions.length > 0);

  return (
    <div className="card">
      <h2 className="card-title">지역별 실거래가</h2>
      <p className="card-sub">
        구·시를 누르면 그 지역의 평단가와 단지 목록을 봅니다. 담아둔 지역만 나옵니다.
      </p>
      {groups.map((g) => (
        <div key={g.sido} style={{ marginTop: 12 }}>
          <div className="history-foot" style={{ marginBottom: 6 }}>
            {g.sido} · {g.regions.length}곳
          </div>
          <div className="region-links">
            {g.regions.map((r) => (
              <Link key={r.code} href={`/region/${r.code}`}>
                {r.name}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

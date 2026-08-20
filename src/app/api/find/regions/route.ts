import { NextResponse } from 'next/server';
import { REGION_BY_CODE } from '@/data/regions';
import { storeMode } from '@/lib/store';
import { fetchAllPaged, serverClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/find/regions
 *
 * 조건 검색에 쓸 수 있는 지역 목록 — **담아둔 곳만** 돌려준다.
 * 전체 250여 시군구를 다 보여주면 담지 않은 지역을 골라 0건을 받고
 * "그 조건에 매물이 없다" 로 잘못 읽는다.
 */
export async function GET() {
  if (storeMode() !== 'supabase') {
    return NextResponse.json({ sidoList: [], reason: 'memory-mode' });
  }
  try {
    const rows = await fetchAllPaged<{ lawd_cd: string }>(
      () => serverClient().from('ingest_log').select('lawd_cd'),
      { label: 'ingest_log 조회' },
    );
    const codes = [...new Set(rows.map((r) => r.lawd_cd))]
      .filter((c) => REGION_BY_CODE.has(c))
      .sort();

    const bySido = new Map<string, { code: string; name: string }[]>();
    for (const code of codes) {
      const r = REGION_BY_CODE.get(code)!;
      const g = bySido.get(r.sido);
      if (g) g.push({ code, name: r.name });
      else bySido.set(r.sido, [{ code, name: r.name }]);
    }

    return NextResponse.json({
      sidoList: [...bySido.entries()].map(([sido, regions]) => ({ sido, regions })),
      total: codes.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

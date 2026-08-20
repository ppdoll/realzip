/**
 * 개별 단지가 구 분포 안에서 어디에 놓이는지 확인한다.
 *
 *   npx tsx scripts/metrics-apt.ts 11680 은마 래미안대치팰리스 도곡렉슬
 *
 * 화면에 붙일 문구("강남구 평균 2.1%, 하위 8%")가 실제 값과 맞는지 보는 용도다.
 */
import { regionJeonseRatios, regionTurnover, position, valuesOf } from '../src/lib/region-metrics';
import { regionLabel } from '../src/data/regions';
import { fetchAllPaged, serverClient } from '../src/lib/supabase';
import { loadEnv } from './env';

loadEnv();

async function main() {
  const [code, ...names] = process.argv.slice(2);
  const [turn, jeonse] = await Promise.all([regionTurnover(code), regionJeonseRatios(code)]);
  const tv = valuesOf(turn.byComplex);
  const jv = valuesOf(jeonse.byComplex);

  const db = serverClient();
  const rows = await fetchAllPaged<{ apt_seq: string; apt_nm: string }>(
    () => db.from('apt_trade').select('apt_seq, apt_nm').eq('lawd_cd', code).gte('deal_ym', '202508'),
    { label: '단지명 조회' },
  );
  const seqOf = new Map<string, string>();
  for (const r of rows) if (!seqOf.has(r.apt_nm)) seqOf.set(r.apt_nm, r.apt_seq);

  console.log(`\n${regionLabel(code)} — 회전율 중위 ${turn.distribution?.median}% · 전세가율 중위 ${jeonse.distribution?.median}%\n`);
  for (const name of names) {
    const hit = [...seqOf.entries()].find(([n]) => n.replace(/\s/g, '').includes(name));
    if (!hit) { console.log(`  ${name} — 최근 거래 없음`); continue; }
    const [full, seq] = hit;
    const t = position(turn.byComplex.get(seq) ?? null, turn.distribution, tv);
    const j = position(jeonse.byComplex.get(seq) ?? null, jeonse.distribution, jv);
    console.log(`  ${full} (${seq})`);
    console.log(`    회전율   ${t ? `${t.value}% · 구 중위 ${t.distribution.median}% · 하위 ${t.percentile}% · ${t.vsMedian}배` : '값 없음 (K-apt 미등록)'}`);
    console.log(`    전세가율 ${j ? `${j.value}% · 구 중위 ${j.distribution.median}% · 하위 ${j.percentile}% · ${j.vsMedian}배` : '값 없음'}`);
  }
  console.log('');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });

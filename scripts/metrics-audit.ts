/**
 * 담아둔 모든 시군구의 회전율·전세가율을 훑어 이상한 값을 찾는다.
 *
 *   npm run metrics:audit            (전체)
 *   npm run metrics:audit -- 11680   (지정한 곳만)
 *
 * 무엇을 이상하다고 보는가 — 각 항목은 "왜 그게 이상한지" 가 있어야 한다.
 *
 *  A. 회전율 15% 초과
 *     1년에 세대의 15% 가 팔린다는 뜻이다. 신축 입주장에는 실제로 가능하지만,
 *     오래된 단지에서 나오면 세대수가 잘못 붙은 것이다.
 *  B. 세대수가 작은데 거래가 많다 (세대 100 미만 & 거래 20건 초과)
 *     오조인의 전형이다. K-apt 에 "대치풍림아이원아파트 1.2단지 (19세대)" 처럼
 *     실제 단지보다 훨씬 작게 등록된 항목이 있어서, 큰 단지 거래가 여기 붙으면
 *     회전율이 폭발한다.
 *  C. 같은 단지의 블록끼리 값이 다르다
 *     합산 로직이 깨졌다는 뜻이다. 0건이어야 한다.
 *  D. 전세가율 100% 초과
 *     전세보증금이 매매가보다 높다. 드물게 실제로 일어나지만(깡통전세),
 *     대개는 평형 버킷이 잘못 묶인 것이다.
 *  E. 전세가율 10% 미만
 *     재건축 대기 단지에서는 정상이다(은마 19%). 그래도 한 자리는 확인 대상이다.
 *  F. 분포 표본 부족 (단지 20곳 미만)
 *     이 구에서는 "구 중위" 비교를 보여주면 안 된다.
 */
import { REGION_BY_CODE, regionLabel } from '../src/data/regions';
import { regionJeonseRatios, regionTurnover } from '../src/lib/region-metrics';
import { recentMonths } from '../src/lib/months';
import { fetchAllPaged, serverClient } from '../src/lib/supabase';
import { loadEnv } from './env';

loadEnv();

type Finding = { code: string; kind: string; detail: string };

const TURNOVER_MAX = 15;
const SMALL_HOUSEHOLDS = 100;
const MANY_SALES = 20;
const MIN_SAMPLE = 20;

async function auditRegion(code: string): Promise<{ findings: Finding[]; line: string }> {
  const findings: Finding[] = [];
  const add = (kind: string, detail: string) => findings.push({ code, kind, detail });

  const [turn, jeonse] = await Promise.all([regionTurnover(code), regionJeonseRatios(code)]);

  // 이름을 붙여서 보고해야 사람이 판단할 수 있다
  const db = serverClient();
  const from12 = recentMonths(12)[0];
  const rows = await fetchAllPaged<{ apt_seq: string; apt_nm: string }>(
    () =>
      db
        .from('apt_trade')
        .select('apt_seq, apt_nm')
        .eq('lawd_cd', code)
        .gte('deal_ym', from12),
    { label: 'apt_trade 이름 조회' },
  );
  const nameOf = new Map<string, string>();
  for (const r of rows) if (!nameOf.has(r.apt_seq)) nameOf.set(r.apt_seq, r.apt_nm);

  // ── A · B: 단지별 계산 내역을 직접 본다
  for (const [kaptCode, e] of turn.byKapt) {
    const label = e.blocks.map((b) => b.aptNm).join(' + ');
    if (e.pct > TURNOVER_MAX) {
      add('A 회전율 과대', `${label} ${e.pct}% (${e.sales}건 / ${e.households}세대) ${kaptCode}`);
    }
    if (e.households < SMALL_HOUSEHOLDS && e.sales > MANY_SALES) {
      add(
        'B 세대수 의심',
        `${label} ${e.households}세대인데 ${e.sales}건 (회전 ${e.pct}%) ${kaptCode}`,
      );
    }
  }

  // ── C: 블록끼리 값이 갈리면 합산이 깨진 것
  for (const e of turn.byKapt.values()) {
    if (e.blocks.length < 2) continue;
    const vals = new Set(e.blocks.map((b) => turn.byComplex.get(b.aptSeq)));
    if (vals.size > 1) {
      add('C 블록 불일치', `${e.blocks.map((b) => b.aptNm).join(' / ')} -> ${[...vals].join(', ')}`);
    }
  }

  // ── D · E: 전세가율 극단
  for (const [aptSeq, v] of jeonse.byComplex) {
    if (v > 100) add('D 전세>매매', `${nameOf.get(aptSeq) ?? aptSeq} ${v}%`);
    else if (v < 10) add('E 전세가율 한자리', `${nameOf.get(aptSeq) ?? aptSeq} ${v}%`);
  }

  // ── F: 표본 부족
  const tn = turn.distribution?.count ?? 0;
  const jn = jeonse.distribution?.count ?? 0;
  if (tn > 0 && tn < MIN_SAMPLE) add('F 회전율 표본 부족', `단지 ${tn}곳`);
  if (jn > 0 && jn < MIN_SAMPLE) add('F 전세가율 표본 부족', `단지 ${jn}곳`);

  const t = turn.distribution;
  const j = jeonse.distribution;
  const line =
    `${regionLabel(code).padEnd(20)} ` +
    `회전 ${t ? `n${String(t.count).padStart(3)} 중위 ${String(t.median).padStart(4)}%` : '   없음      '} · ` +
    `전세 ${j ? `n${String(j.count).padStart(3)} 중위 ${String(j.median).padStart(4)}%` : '   없음      '}` +
    (findings.length ? `  ⚠ ${findings.length}` : '');

  return { findings, line };
}

async function main() {
  const argCodes = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  let codes: string[];
  if (argCodes.length > 0) {
    codes = argCodes;
  } else {
    // 매매를 담아둔 시군구만 본다 (ingest_log 에 기록이 있는 곳)
    const logs = await fetchAllPaged<{ lawd_cd: string }>(
      () => serverClient().from('ingest_log').select('lawd_cd'),
      { label: 'ingest_log 조회' },
    );
    codes = [...new Set(logs.map((l) => l.lawd_cd))]
      .filter((c) => REGION_BY_CODE.has(c))
      .sort();
  }
  console.log(`감사 대상 ${codes.length}곳\n`);

  const all: Finding[] = [];
  // 동시에 4곳씩 — DB 부담과 시간의 절충
  for (let i = 0; i < codes.length; i += 4) {
    const batch = codes.slice(i, i + 4);
    const res = await Promise.all(
      batch.map(async (c) => {
        try {
          return await auditRegion(c);
        } catch (e) {
          return {
            findings: [{ code: c, kind: '조회 실패', detail: e instanceof Error ? e.message : String(e) }],
            line: `${regionLabel(c).padEnd(20)} 조회 실패`,
          };
        }
      }),
    );
    for (const r of res) {
      console.log('  ' + r.line);
      all.push(...r.findings);
    }
  }

  console.log(`\n${'='.repeat(78)}`);
  if (all.length === 0) {
    console.log('이상한 값 없음');
    return;
  }
  const byKind = new Map<string, Finding[]>();
  for (const f of all) {
    const g = byKind.get(f.kind);
    if (g) g.push(f);
    else byKind.set(f.kind, [f]);
  }
  for (const kind of [...byKind.keys()].sort()) {
    const list = byKind.get(kind)!;
    console.log(`\n■ ${kind} — ${list.length}건`);
    for (const f of list.slice(0, 25)) {
      console.log(`   ${REGION_BY_CODE.get(f.code)?.name ?? f.code}: ${f.detail}`);
    }
    if (list.length > 25) console.log(`   … ${list.length - 25}건 더`);
  }
  console.log(`\n총 ${all.length}건`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * 지역 장기 가격지수 적재 — 원본을 저장하지 않는다.
 *
 *   npm run ingest:index -- 11680 --years=10
 *   npm run ingest:index -- 서울 --years=10 --max-calls=4000
 *   npm run ingest:index -- --all --years=10 --dry
 *
 * 국토부에서 한 달을 받아 **평단가 중위·사분위·건수만 남기고 원본은 버린다.**
 * 10년치 원본은 매매만 850MB 라 무료 티어의 두 배지만, 이 요약은 지역당
 * 120행이라 전체 9,120행(약 1MB)이다.
 *
 * 이미 있는 달은 건너뛴다. 최근 3개월은 신고가 계속 들어오므로 항상 다시 받는다.
 */
import { REGION_BY_CODE, regionLabel, regionsBySido } from '../src/data/regions';
import { fetchAllPaged, serverClient } from '../src/lib/supabase';
import { fetchMonths } from '../src/lib/molit';
import { addMonths, monthRange, recentMonths, toYm } from '../src/lib/months';
import { indexedMonths, saveRegionIndex, summarizeMonths } from '../src/lib/region-index';
import { assertServiceKey } from '../src/lib/molit';
import { loadEnv } from './env';

loadEnv();

/** 최근 이 개월 수는 신고가 계속 들어와서 이미 있어도 다시 받는다 */
const REFRESH_TAIL = 3;

function parseArgs() {
  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const rest = argv.filter((a) => !a.startsWith('--'));
  const num = (name: string, dflt: number) => {
    const f = flags.find((x) => x.startsWith(`--${name}=`));
    return f ? Number(f.split('=')[1]) : dflt;
  };
  return {
    codes: rest,
    all: flags.includes('--all'),
    dry: flags.includes('--dry'),
    years: num('years', 10),
    maxCalls: num('max-calls', 4000),
  };
}

function resolveCodes(codes: string[], all: boolean): string[] {
  if (all) return [...REGION_BY_CODE.keys()];
  const out: string[] = [];
  for (const c of codes) {
    if (/^\d{5}$/.test(c)) {
      out.push(c);
      continue;
    }
    // 시도 이름으로 넘기면 그 시도 전체
    for (const g of regionsBySido()) {
      if (g.sido.includes(c)) out.push(...g.regions.map((r) => r.code));
    }
  }
  return [...new Set(out)];
}

async function main() {
  assertServiceKey();
  const { codes, all, dry, years, maxCalls } = parseArgs();

  let targets = resolveCodes(codes, all);
  if (targets.length === 0) {
    // 아무것도 안 주면 이미 실거래를 담아둔 지역을 쓴다
    const logs = await fetchAllPaged<{ lawd_cd: string }>(
      () => serverClient().from('ingest_log').select('lawd_cd'),
      { label: 'ingest_log 조회' },
    );
    targets = [...new Set(logs.map((l) => l.lawd_cd))].filter((c) => REGION_BY_CODE.has(c)).sort();
  }

  const end = toYm(new Date());
  const start = addMonths(end, -(years * 12 - 1));
  const allMonths = monthRange(start, end);
  const refreshFrom = recentMonths(REFRESH_TAIL)[0];

  console.log(
    `대상 ${targets.length}곳 · ${start} ~ ${end} (${allMonths.length}개월) · 호출 상한 ${maxCalls.toLocaleString('ko-KR')}회`,
  );
  console.log('원본은 저장하지 않고 월별 요약만 남깁니다.\n');

  let calls = 0;
  let saved = 0;
  let done = 0;

  for (const code of targets) {
    const label = regionLabel(code);
    const have = await indexedMonths(code);
    const need = allMonths.filter((ym) => !have.has(ym) || ym >= refreshFrom);
    if (need.length === 0) {
      console.log(`· ${label} — 이미 있음 (${have.size}개월)`);
      done++;
      continue;
    }
    if (dry) {
      console.log(`  ${label} — 받을 달 ${need.length} (있는 달 ${have.size})`);
      calls += need.length;
      continue;
    }
    if (calls + need.length > maxCalls) {
      console.log(`\n호출 상한에 닿아 멈춥니다. 남은 지역 ${targets.length - done}곳.`);
      break;
    }

    const t0 = Date.now();
    const results = await fetchMonths(code, need, { concurrency: 4 });
    calls += need.length;

    // 여기서 원본을 쓰고 버린다 — 저장하는 것은 아래 요약뿐이다
    const trades = results.flatMap((r) => r.trades ?? []);
    const failed = results.filter((r) => r.error).length;
    const rows = summarizeMonths(code, trades);
    const n = await saveRegionIndex(rows);
    saved += n;
    done++;
    console.log(
      `  ✓ ${label} — ${need.length}개월 받아 ${n}개월 저장 (거래 ${trades.length.toLocaleString('ko-KR')}건은 버림)` +
        `${failed ? ` · 실패 ${failed}` : ''} · ${((Date.now() - t0) / 1000).toFixed(0)}초`,
    );
  }

  console.log(
    `\n${dry ? '예상 호출' : '완료'} — 지역 ${done}곳 · 저장 ${saved.toLocaleString('ko-KR')}행 · 호출 ${calls.toLocaleString('ko-KR')}회`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

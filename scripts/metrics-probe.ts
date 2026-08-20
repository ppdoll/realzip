/**
 * 구 단위 분포가 정말 "읽히는 값"인지 실제 데이터로 재본다.
 *
 *   npx tsx scripts/metrics-probe.ts 11680 11350 11500
 *
 * 화면에 붙이기 전에 확인할 것:
 *   1. 분포가 퍼져 있는가 (전부 같은 값이면 비교가 무의미하다)
 *   2. 몇 개 단지가 값을 얻는가 (조인 실패가 많으면 분포가 편향된다)
 *   3. 구끼리 순서가 상식과 맞는가 (강남 전세가율 < 노원)
 */
import { REGION_BY_CODE, regionLabel } from '../src/data/regions';
import { regionJeonseRatios, regionTurnover } from '../src/lib/region-metrics';
import { quantile } from '../src/lib/stats';
import { loadEnv } from './env';

loadEnv();

async function main() {
  const codes = process.argv.slice(2).filter((a) => /^\d{5}$/.test(a));
  if (codes.length === 0) {
    console.error('시군구 코드를 넘겨주세요.');
    process.exit(1);
  }

  const f1 = (n: number) => n.toFixed(1).padStart(5);

  for (const code of codes) {
    if (!REGION_BY_CODE.has(code)) {
      console.log(`${code} — 모르는 코드`);
      continue;
    }
    const t0 = Date.now();
    const [turn, jeonse] = await Promise.all([regionTurnover(code), regionJeonseRatios(code)]);
    const ms = Date.now() - t0;

    console.log(`\n═══ ${regionLabel(code)} (${code}) · ${(ms / 1000).toFixed(1)}초`);

    for (const [name, info] of [
      ['회전율   ', turn],
      ['전세가율 ', jeonse],
    ] as const) {
      const v = [...info.byComplex.values()].sort((a, b) => a - b);
      if (v.length === 0) {
        console.log(`  ${name} 표본 0 — 계산 불가`);
        continue;
      }
      const d = info.distribution;
      console.log(
        `  ${name} 단지 ${String(d?.count ?? v.length).padStart(3)}` +
        (d && d.count !== v.length ? `(블록 ${v.length})` : '     ') +
          ` | p10 ${f1(quantile(v, 0.1))}  p25 ${f1(quantile(v, 0.25))}` +
          `  중위 ${f1(quantile(v, 0.5))}  p75 ${f1(quantile(v, 0.75))}  p90 ${f1(quantile(v, 0.9))}` +
          ` | 폭(p75/p25) ${(quantile(v, 0.75) / Math.max(quantile(v, 0.25), 0.01)).toFixed(2)}배` +
          (d ? '' : '  ⚠ 표본 5 미만이라 분포 없음'),
      );
    }

    // 이 구에서 값이 있는 단지 중 양 극단을 눈으로 본다
    const sorted = [...turn.byComplex.entries()].sort((a, b) => a[1] - b[1]);
    if (sorted.length >= 4) {
      const show = (e: [string, number]) => `${e[0]}=${e[1]}%`;
      console.log(
        `    회전율 최저: ${sorted.slice(0, 2).map(show).join(', ')}` +
          ` / 최고: ${sorted.slice(-2).map(show).join(', ')}`,
      );
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * 두번째 부분: 특정 단지가 분포 안에서 어디에 놓이는지 확인한다.
 *   npx tsx scripts/metrics-probe.ts 11680 --apt=은마
 */

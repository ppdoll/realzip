/**
 * 시군구 코드 유효성 점검.
 *
 *   npm run probe               # 전국 전체
 *   npm run probe -- 11680      # 특정 코드만
 *   npm run probe -- 서울       # 시/도 이름으로 필터
 *   npm run probe -- --raw 11680  # 원본 응답 태그명 확인 (파서 진단)
 *
 * 최근 몇 달을 실제로 조회해 거래가 0건인 코드를 찾아낸다.
 * 거래가 아예 없는 군 지역도 있으니, 0건이 곧 오류는 아니다 —
 * "서울/경기의 큰 구가 0건" 같은 경우만 코드 오류로 의심하면 된다.
 */
import { loadEnv } from './env';

loadEnv();

async function main() {
  const { REGIONS } = await import('../src/data/regions');
  const { fetchMonth } = await import('../src/lib/molit');
  const { recentMonths } = await import('../src/lib/months');
  const { mapLimit } = await import('../src/lib/molit');

  if (!process.env.MOLIT_SERVICE_KEY) {
    console.error('MOLIT_SERVICE_KEY 가 없습니다. .env.local 을 먼저 채워주세요.');
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  const filter = argv.filter((a) => !a.startsWith('-'));

  // --raw: 원본 태그명을 그대로 출력해 파서 매핑이 맞는지 눈으로 확인한다.
  if (argv.includes('--raw')) {
    const { fetchRawSample } = await import('../src/lib/molit');
    const code = filter[0] ?? '11680';
    const ym = recentMonths(4)[0];
    const items = await fetchRawSample(code, ym, 2);
    if (items.length === 0) {
      console.log(`${code} ${ym} 에 거래가 없습니다. 다른 코드/월로 시도하세요.`);
      return;
    }
    console.log(`${code} ${ym} 원본 항목 태그:`);
    console.log(Object.keys(items[0]).join(', '));
    console.log('');
    console.log('첫 항목 전체:');
    console.log(JSON.stringify(items[0], null, 2));
    return;
  }

  const targets = REGIONS.filter(
    (r) =>
      filter.length === 0 ||
      filter.some((f) => r.code === f || r.sido.includes(f) || r.name.includes(f)),
  );

  // 최근 4개월 중 아무 달에서라도 거래가 나오면 유효한 코드로 본다.
  const months = recentMonths(5).slice(0, 4);
  console.log(`${targets.length}개 시군구 × ${months.join(', ')} 점검 시작\n`);

  let empty = 0;
  let failed = 0;

  await mapLimit(targets, 4, async (r) => {
    let total = 0;
    let err: string | null = null;
    for (const ym of months) {
      try {
        total += (await fetchMonth(r.code, ym)).length;
        if (total > 0) break;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    const label = `${r.code} ${r.sido} ${r.name}`.padEnd(34, ' ');
    if (err) {
      failed++;
      console.log(`✗ ${label} 오류: ${err}`);
    } else if (total === 0) {
      empty++;
      console.log(`· ${label} 거래 0건${r.legacy ? ` (구 코드 ${r.legacy} 도 확인함)` : ''}`);
    } else {
      console.log(`✓ ${label} ${total}건`);
    }
  });

  console.log(
    `\n완료 — 정상 ${targets.length - empty - failed} / 0건 ${empty} / 오류 ${failed}`,
  );
  if (empty > 0) {
    console.log(
      '0건으로 나온 곳이 인구 많은 시·구라면 src/data/regions.ts 의 코드를 확인하세요.',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

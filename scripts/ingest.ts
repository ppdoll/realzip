/**
 * 지역 데이터 미리 적재 — 매매 3년 + 전월세 1년.
 *
 *   npm run ingest -- 서울            시/도 이름으로
 *   npm run ingest -- 11110 11140     시군구 코드로
 *   npm run ingest -- 경기도 --rent-only
 *   npm run ingest -- 서울 --dry      무엇을 받을지만 보기
 *
 * 이미 받아둔 달은 건너뛰므로 중간에 끊고 다시 돌려도 된다.
 * Supabase 가 설정되어 있어야 의미가 있다 (메모리 모드면 프로세스 종료 시 사라진다).
 */
import { loadEnv } from './env';

loadEnv();

/** 지역당 대략 용량 (실측: 매매 3년 ~4.5MB + 전월세 1년 ~1.4MB) */
const MB_PER_REGION = 6;
const FREE_TIER_MB = 500;

async function main() {
  const { REGIONS, regionLabel } = await import('../src/data/regions');
  const { FETCH_CONCURRENCY, RENT_WINDOW_MONTHS, WINDOW_MONTHS } = await import(
    '../src/lib/config'
  );
  const { recentMonths } = await import('../src/lib/months');
  const { getRegionTrades, storeMode } = await import('../src/lib/store');
  const { getRegionRents } = await import('../src/lib/store-rent');
  const { serverClient } = await import('../src/lib/supabase');

  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const filters = argv.filter((a) => !a.startsWith('--'));
  const dry = flags.has('--dry');
  const rentOnly = flags.has('--rent-only');
  const saleOnly = flags.has('--sale-only');

  if (!process.env.MOLIT_SERVICE_KEY) {
    console.error('MOLIT_SERVICE_KEY 가 없습니다. .env.local 을 채워주세요.');
    process.exit(1);
  }
  if (storeMode() !== 'supabase') {
    console.error(
      'Supabase 가 설정되지 않았습니다. 메모리 모드로 적재해도 프로세스가 끝나면 사라집니다.',
    );
    process.exit(1);
  }

  const targets = REGIONS.filter(
    (r) =>
      filters.length > 0 &&
      filters.some((f) => r.code === f || r.sido.includes(f) || r.name.includes(f)),
  );

  if (targets.length === 0) {
    console.error(
      '대상이 없습니다. 예: npm run ingest -- 서울 / npm run ingest -- 11110 11140\n' +
        '(전국을 한 번에 담으면 무료 티어를 넘깁니다 — 시/도 단위로 나눠 돌리세요.)',
    );
    process.exit(2);
  }

  const saleMonths = recentMonths(WINDOW_MONTHS);
  const rentMonths = recentMonths(RENT_WINDOW_MONTHS);
  const saleFrom = saleMonths[0];
  const to = saleMonths[saleMonths.length - 1];
  const rentFrom = rentMonths[0];

  const calls =
    targets.length * ((saleOnly ? 0 : RENT_WINDOW_MONTHS) + (rentOnly ? 0 : WINDOW_MONTHS));

  console.log(`대상 ${targets.length}곳 · 매매 ${saleFrom}~${to} · 전월세 ${rentFrom}~${to}`);
  console.log(
    `최대 API 호출 ${calls.toLocaleString('ko-KR')}회 (개발계정 일일 10,000회) · ` +
      `예상 증가 약 ${(targets.length * MB_PER_REGION).toLocaleString('ko-KR')}MB`,
  );

  const db = serverClient();
  const sizeNow = async () => {
    const t = await db.from('apt_trade').select('*', { count: 'exact', head: true });
    const r = await db.from('apt_rent').select('*', { count: 'exact', head: true });
    return { trades: t.count ?? 0, rents: r.count ?? 0 };
  };
  const before = await sizeNow();
  const estMb = ((before.trades + before.rents) * 450) / 1024 / 1024;
  console.log(
    `현재 매매 ${before.trades.toLocaleString('ko-KR')}행 · 전월세 ${before.rents.toLocaleString('ko-KR')}행 ` +
      `(약 ${estMb.toFixed(1)}MB / ${FREE_TIER_MB}MB)\n`,
  );

  if (dry) {
    for (const r of targets) console.log(`  ${r.code} ${regionLabel(r.code)}`);
    console.log('\n--dry 이므로 실제로 받지 않았습니다.');
    return;
  }

  let ok = 0;
  let failed = 0;
  const t0 = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const label = `[${i + 1}/${targets.length}] ${regionLabel(r.code)}`;
    const rt0 = Date.now();
    const parts: string[] = [];

    try {
      if (!rentOnly) {
        const s = await getRegionTrades(r.code, saleFrom, to, {
          concurrency: FETCH_CONCURRENCY,
        });
        parts.push(`매매 ${s.trades.length.toLocaleString('ko-KR')}행(신규 ${s.fetchedMonths}개월)`);
        if (s.errors.length) parts.push(`매매오류 ${s.errors.length}개월`);
      }
      if (!saleOnly) {
        const rr = await getRegionRents(r.code, rentFrom, to, {
          concurrency: FETCH_CONCURRENCY,
        });
        parts.push(`전월세 ${rr.rents.length.toLocaleString('ko-KR')}행(신규 ${rr.fetchedMonths}개월)`);
        if (rr.errors.length) parts.push(`전월세오류 ${rr.errors.length}개월`);
      }
      ok++;
      console.log(`✓ ${label} — ${parts.join(' · ')} · ${((Date.now() - rt0) / 1000).toFixed(1)}초`);
    } catch (e) {
      failed++;
      console.log(`✗ ${label} — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const after = await sizeNow();
  const afterMb = ((after.trades + after.rents) * 450) / 1024 / 1024;
  console.log(
    `\n완료 — 성공 ${ok} / 실패 ${failed} · ${((Date.now() - t0) / 1000).toFixed(0)}초`,
  );
  console.log(
    `매매 ${after.trades.toLocaleString('ko-KR')}행(+${(after.trades - before.trades).toLocaleString('ko-KR')}) · ` +
      `전월세 ${after.rents.toLocaleString('ko-KR')}행(+${(after.rents - before.rents).toLocaleString('ko-KR')})`,
  );
  console.log(
    `추정 용량 약 ${afterMb.toFixed(1)}MB / ${FREE_TIER_MB}MB (${((afterMb / FREE_TIER_MB) * 100).toFixed(1)}%)`,
  );
  if (afterMb / FREE_TIER_MB > 0.6) {
    console.log('⚠ 무료 티어의 60%를 넘었습니다. 지역을 더 늘리려면 플랜을 검토하세요.');
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

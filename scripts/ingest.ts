/**
 * 지역 데이터 미리 적재 — 매매 3년 + 전월세 1년.
 *
 *   npm run ingest -- 서울             시/도 이름으로
 *   npm run ingest -- 11110 11140      시군구 코드로
 *   npm run ingest -- 경기주요          미리 정의된 묶음 (아래 PRESETS)
 *   npm run ingest -- 서울 --dry       무엇을 받을지만 보기
 *   npm run ingest -- 경기주요 --max-mb=420
 *
 * 무료 티어(500MB)가 있으므로 --max-mb 상한에 닿으면 새 지역을 시작하지 않고 멈춘다.
 * 남은 지역을 알려주므로 플랜을 올린 뒤 이어서 돌리면 된다.
 *
 * 이미 받아둔 달은 건너뛰므로 중간에 끊고 다시 돌려도 된다.
 * Supabase 가 설정되어 있어야 의미가 있다 (메모리 모드면 프로세스 종료 시 사라진다).
 */
import { loadEnv } from './env';

loadEnv();

/** 지역당 용량 — npm run db:size 실측 기준 (매매 3년 + 전월세 1년, 인덱스 포함) */
const MB_PER_REGION = 7;
const FREE_TIER_MB = 500;
/** 기본 상한 — 무료 티어의 84%. 여유를 남겨 크론 갱신이 막히지 않게 한다. */
const DEFAULT_MAX_MB = 420;

/**
 * 미리 정의한 묶음.
 *
 * `경기주요` 는 아파트 거래량이 많은 순서로 넣었다 — 용량 상한에 걸려 중간에 멈춰도
 * 사람들이 실제로 많이 찾는 지역이 먼저 들어가도록.
 * (경기도 42곳을 전부 담으면 약 250MB 라 무료 티어를 넘긴다.)
 */
const PRESETS: Record<string, string[]> = {
  경기주요: [
    '41135', // 성남시 분당구
    '41117', // 수원시 영통구
    '41285', // 고양시 일산동구
    '41287', // 고양시 일산서구
    '41465', // 용인시 수지구
    '41463', // 용인시 기흥구
    '41173', // 안양시 동안구
    '41131', // 성남시 수정구
    '41133', // 성남시 중원구
    '41113', // 수원시 권선구
    '41111', // 수원시 장안구
    '41115', // 수원시 팔달구
    '41192', // 부천시 원미구
    '41194', // 부천시 소사구
    '41196', // 부천시 오정구
    '41597', // 화성시 동탄구 (거래량 최다)
    '41595', // 화성시 병점구
    '41593', // 화성시 효행구
    '41591', // 화성시 만세구
    '41360', // 남양주시
    '41281', // 고양시 덕양구
    '41273', // 안산시 단원구
    '41271', // 안산시 상록구
    '41220', // 평택시
    '41390', // 시흥시
    '41570', // 김포시
    '41480', // 파주시
    '41210', // 광명시
    '41450', // 하남시
    '41150', // 의정부시
    '41171', // 안양시 만안구
    '41461', // 용인시 처인구
    '41310', // 구리시
    '41410', // 군포시
    '41610', // 광주시
    '41370', // 오산시
    '41430', // 의왕시
    '41290', // 과천시
  ],
};

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
  const maxMbFlag = [...flags].find((f) => f.startsWith('--max-mb='));
  const maxMb = maxMbFlag ? Number(maxMbFlag.split('=')[1]) : DEFAULT_MAX_MB;
  if (!Number.isFinite(maxMb) || maxMb <= 0) {
    console.error('--max-mb 값이 잘못되었습니다.');
    process.exit(2);
  }

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

  // 묶음 이름이 오면 그 순서를 그대로 지킨다 (거래량 순으로 넣어둔 의미가 있다)
  const presetName = filters.find((f) => PRESETS[f]);
  const targets = presetName
    ? PRESETS[presetName]
        .map((code) => REGIONS.find((r) => r.code === code))
        .filter((r): r is (typeof REGIONS)[number] => r !== undefined)
    : REGIONS.filter(
        (r) =>
          filters.length > 0 &&
          filters.some((f) => r.code === f || r.sido.includes(f) || r.name.includes(f)),
      );

  if (targets.length === 0) {
    console.error(
      [
        '대상이 없습니다.',
        '  예:   npm run ingest -- 서울',
        '        npm run ingest -- 11110 11140',
        `  묶음: ${Object.keys(PRESETS).join(', ')}`,
        '(전국을 한 번에 담으면 무료 티어를 넘깁니다 — 나눠 돌리세요.)',
      ].join('\n'),
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
  const estMb = ((before.trades + before.rents) * 390) / 1024 / 1024;
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
  let stoppedAt = -1;
  const t0 = Date.now();
  const currentMb = async () => {
    const c = await sizeNow();
    return ((c.trades + c.rents) * 390) / 1024 / 1024;
  };

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];

    // 상한에 닿으면 새 지역을 시작하지 않는다 — 중간에 꽉 차서 쓰기가 막히는 게 더 나쁘다.
    const mb = await currentMb();
    if (mb + MB_PER_REGION > maxMb) {
      stoppedAt = i;
      console.log('');
      console.log(
        `■ 상한 도달 — 현재 약 ${mb.toFixed(1)}MB, 한 지역 더 담으면 ${maxMb}MB 를 넘습니다.`,
      );
      break;
    }
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
  const afterMb = ((after.trades + after.rents) * 390) / 1024 / 1024;
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
  if (stoppedAt >= 0) {
    const rest = targets.slice(stoppedAt);
    console.log('');
    console.log(`담지 못한 ${rest.length}곳:`);
    console.log('  ' + rest.map((r) => regionLabel(r.code)).join(', '));
    console.log('플랜을 올리거나 --max-mb 를 높인 뒤 같은 명령을 다시 돌리면 이어집니다.');
  } else if (afterMb / FREE_TIER_MB > 0.6) {
    console.log('⚠ 무료 티어의 60%를 넘었습니다. 지역을 더 늘리려면 플랜을 검토하세요.');
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

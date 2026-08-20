/**
 * 공동주택 단지 정보(K-apt) 적재.
 *
 *   npm run ingest:kapt -- 서울           시/도 이름으로
 *   npm run ingest:kapt -- 11680 11650    시군구 코드로
 *   npm run ingest:kapt -- 서울 --dry     호출량만 계산
 *   npm run ingest:kapt -- 서울 --max-calls=4500
 *
 * 실거래가 적재와 따로 두는 이유는 **호출 특성이 완전히 다르기** 때문이다.
 *   · 단지당 1회 호출 (시군구 하나가 200~250회)
 *   · 초당 제한이 엄격해서 동시 실행 없이 350ms 간격 순차
 *   · 개발계정 일일 5,000회 → 하루에 시군구 20곳 정도가 한계
 * 대신 세대수·준공일 같은 값은 바뀌지 않으니 한 번 받으면 다시 받을 일이 없다.
 * 이미 받은 시군구는 건너뛴다.
 */
import { loadEnv } from './env';

loadEnv();

/** 개발계정 일일 한도. 여유를 남긴다. */
const DEFAULT_MAX_CALLS = 4500;

async function main() {
  const { REGIONS, regionLabel } = await import('../src/data/regions');
  const { fetchKaptInfos, fetchKaptList } = await import('../src/lib/kapt');
  const { kaptIngested, saveKaptInfos } = await import('../src/lib/store-kapt');
  const { storeMode } = await import('../src/lib/store');

  const argv = process.argv.slice(2);
  const flags = argv.filter((a) => a.startsWith('--'));
  const filters = argv.filter((a) => !a.startsWith('--'));
  const dry = flags.includes('--dry');
  const force = flags.includes('--force');
  const maxFlag = flags.find((f) => f.startsWith('--max-calls='));
  const maxCalls = maxFlag ? Number(maxFlag.split('=')[1]) : DEFAULT_MAX_CALLS;

  if (!process.env.MOLIT_SERVICE_KEY) {
    console.error('MOLIT_SERVICE_KEY 가 없습니다.');
    process.exit(1);
  }
  if (storeMode() !== 'supabase') {
    console.error('Supabase 가 설정되지 않았습니다.');
    process.exit(1);
  }
  if (filters.length === 0) {
    console.error('대상이 없습니다. 예: npm run ingest:kapt -- 서울');
    process.exit(2);
  }

  const targets = REGIONS.filter((r) =>
    filters.some((f) => r.code === f || r.sido.includes(f) || r.name.includes(f)),
  );
  if (targets.length === 0) {
    console.error('일치하는 시군구가 없습니다.');
    process.exit(2);
  }

  console.log(`대상 ${targets.length}곳 · 호출 상한 ${maxCalls.toLocaleString('ko-KR')}회`);
  console.log('(단지당 1회 · 350ms 간격 순차 — 초당 제한이 엄격해서 동시 실행하지 않습니다)\n');

  let calls = 0;
  let saved = 0;
  let skipped = 0;
  let stopped = false;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const label = `[${i + 1}/${targets.length}] ${regionLabel(r.code)}`;

    if (!force) {
      const done = await kaptIngested(r.code);
      if (done) {
        skipped++;
        console.log(`· ${label} — 이미 받음 (${done.complexes}단지)`);
        continue;
      }
    }

    let list;
    try {
      list = await fetchKaptList(r.code);
      calls++;
    } catch (e) {
      console.log(`✗ ${label} — 목록 실패: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    if (list.length === 0) {
      console.log(`· ${label} — K-apt 등록 단지 없음`);
      continue;
    }

    if (calls + list.length > maxCalls) {
      console.log(
        `\n■ 호출 상한 도달 — ${label} 은 ${list.length}단지가 필요한데 남은 여유가 ` +
          `${maxCalls - calls}회입니다. 내일 같은 명령을 다시 돌리면 이어집니다.`,
      );
      stopped = true;
      break;
    }

    if (dry) {
      console.log(`· ${label} — ${list.length}단지 (호출 ${list.length}회 예정)`);
      calls += list.length;
      continue;
    }

    const t0 = Date.now();
    const { infos, failed } = await fetchKaptInfos(
      list.map((k) => k.kaptCode),
      {
        onProgress: (done, total) => {
          if (done % 50 === 0 || done === total) {
            process.stdout.write(`\r  ${label} ${done}/${total}…   `);
          }
        },
      },
    );
    calls += list.length;

    // 목록에만 있는 법정동을 기본 정보 쪽 파싱이 실패했을 때 보충한다
    const byCode = new Map(list.map((k) => [k.kaptCode, k]));
    for (const info of infos) {
      if (!info.umdNm) info.umdNm = byCode.get(info.kaptCode)?.umdNm ?? null;
    }

    const n = await saveKaptInfos(r.code, infos);
    saved += n;
    const withJibun = infos.filter((x) => x.jibun).length;
    process.stdout.write('\r');
    console.log(
      `✓ ${label} — ${n}단지 저장 (지번 파싱 ${withJibun}) · 실패 ${failed.length} · ` +
        `${((Date.now() - t0) / 1000).toFixed(0)}초`,
    );
    if (failed.length > 0) console.log(`    첫 실패: ${failed[0].message.slice(0, 90)}`);
  }

  console.log(
    `\n완료 — 저장 ${saved.toLocaleString('ko-KR')}단지 · 건너뜀 ${skipped}곳 · ` +
      `호출 ${calls.toLocaleString('ko-KR')}회`,
  );
  if (stopped) console.log('상한에서 멈췄습니다. 하루 뒤 같은 명령으로 이어서 받으세요.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

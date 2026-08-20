/**
 * Supabase 연결 점검 — 앱이 실제로 쓰는 경로(supabase-js + service_role)로 확인한다.
 *
 *   npm run db:check
 *
 * 테이블 존재 / 읽기 / 쓰기(업서트+삭제) / 적재량 / 무료 티어 여유를 봅니다.
 * 국토부 API 를 호출하지 않으므로 트래픽을 쓰지 않습니다.
 */
// 앱이 실제로 쓰는 클라이언트를 그대로 쓴다 (Realtime transport 처리 포함).
// serverClient() 는 호출 시점에 환경변수를 읽으므로 정적 import 로 충분하다.
import { classifyKey, fetchAllPaged, KEY_LABEL, serverClient } from '../src/lib/supabase';
import { WINDOW_MONTHS } from '../src/lib/config';
import { recentMonths } from '../src/lib/months';
import { regionLabel } from '../src/data/regions';
import { loadEnv } from './env';

loadEnv();

/** 행당 바이트 — npm run db:size 로 실측 (인덱스 포함, 2026-08 기준) */
const BYTES_PER_ROW = 390;
const FREE_TIER_BYTES = 500 * 1024 * 1024;

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    console.error(
      [
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.',
        '',
        'Supabase 대시보드 → Project Settings → API Keys 에서:',
        '  SUPABASE_URL             = Project URL',
        '  SUPABASE_SERVICE_ROLE_KEY = service_role (secret) 키',
        '',
        'service_role 키는 RLS 를 우회하므로 서버에서만 씁니다.',
        'NEXT_PUBLIC_ 접두어를 붙이면 브라우저로 노출되니 절대 붙이지 마세요.',
      ].join('\n'),
    );
    process.exit(1);
  }
  const kind = classifyKey(key);
  if (kind !== 'secret') {
    console.error(
      [
        `넣으신 키는 ${KEY_LABEL[kind]} 입니다 — 이 앱에는 쓸 수 없습니다.`,
        '',
        'apt_trade / ingest_log 는 RLS 를 켜고 정책을 두지 않았습니다. 서버만 접근하는',
        '테이블이라 그게 맞고, 그래서 RLS 를 우회하는 secret 키가 필요합니다.',
        'publishable / anon 키는 브라우저에 노출되도록 설계된 공개 키라서, 그 키로',
        '쓰기가 되게 만들면 누구나 이 테이블에 값을 넣을 수 있게 됩니다.',
        '',
        '대시보드 → Project Settings → API Keys 에서:',
        '  · 새 형식이면  sb_secret_... (Secret keys 섹션)',
        '  · 옛 형식이면  service_role (secret) 로 표시된 JWT',
        '',
        '이 값은 채팅에 붙여넣지 말고 .env.local 의 SUPABASE_SERVICE_ROLE_KEY= 뒤에',
        '직접 넣어주세요. 그 뒤 npm run db:check 를 다시 실행하면 됩니다.',
      ].join('\n'),
    );
    process.exit(1);
  }

  const db = serverClient();
  console.log(`대상: ${url}\n`);

  let failed = 0;
  const step = (ok: boolean, name: string, detail = '') => {
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failed++;
  };

  // 1) 테이블 존재 + 읽기
  //
  // head:true 카운트 쿼리는 테이블이 없어도 error 없이 count=null 로 돌아온다.
  // 그걸 0행으로 읽으면 "테이블 없음"이 "빈 테이블"로 보여 거짓 통과가 된다.
  // 그래서 존재 확인은 본문이 있는 limit(1) 조회로 먼저 한다.
  const counts: Record<string, number> = {};
  let missingTable = false;

  for (const table of ['apt_trade', 'ingest_log', 'apt_rent', 'rent_ingest_log']) {
    const probe = await db.from(table).select('*').limit(1);
    if (probe.error) {
      step(false, `${table} 읽기`, probe.error.message);
      if (/does not exist|schema cache/i.test(probe.error.message)) missingTable = true;
      continue;
    }

    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
    if (error || count === null) {
      step(false, `${table} 행 수 조회`, error?.message ?? 'count 가 비어 있습니다');
      continue;
    }
    counts[table] = count;
    step(true, `${table} 읽기`, `${count.toLocaleString('ko-KR')}행`);
  }

  if (missingTable) {
    console.log('');
    console.log('테이블이 아직 없습니다. 둘 중 하나만 하면 됩니다.');
    console.log('  (a) .env.local 에 SUPABASE_DB_URL 을 넣고  npm run db:setup');
    console.log('  (b) src/lib/schema.sql 을 SQL Editor 에 붙여넣고 실행');
    const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1];
    if (ref) console.log(`      → https://supabase.com/dashboard/project/${ref}/sql/new`);
  }

  // 2) 쓰기 — 실제 적재와 같은 업서트 경로를 쓰고, 흔적은 지운다
  if (counts.apt_trade !== undefined) {
    const probeId = '__db_check_probe__';
    const { error: upErr } = await db.from('apt_trade').upsert(
      [
        {
          id: probeId,
          lawd_cd: '00000',
          deal_ym: '190001',
          apt_seq: probeId,
          apt_nm: '연결점검용',
          area: 1,
          deal_date: '1900-01-01',
          amount: 1,
        },
      ],
      { onConflict: 'id' },
    );
    step(!upErr, 'apt_trade 쓰기(업서트)', upErr?.message ?? '');

    if (!upErr) {
      const { error: delErr } = await db.from('apt_trade').delete().eq('id', probeId);
      step(!delErr, '점검 행 삭제', delErr?.message ?? '');
    }
  }

  // 3) 지역별 월 커버리지
  //
  // 수집 중 한 달이 실패하면 그 달만 ingest_log 에 안 남고, 그 지역을 조회할 때마다
  // 그 달을 다시 부른다. 조용히 트래픽을 새게 하는 유형이라 눈에 보이게 해둔다.
  if (counts.ingest_log !== undefined && counts.ingest_log > 0) {
    // 페이지네이션 필수 — 지역이 28곳을 넘으면 1,000행 상한에 걸려
    // 있는 데이터를 "누락된 달"로 잘못 보고한다 (실제로 겪었다).
    let data: { lawd_cd: string; deal_ym: string; rows: number }[] | null = null;
    let coverageError: string | null = null;
    try {
      data = await fetchAllPaged<{ lawd_cd: string; deal_ym: string; rows: number }>(
        () => db.from('ingest_log').select('lawd_cd, deal_ym, rows'),
        { label: 'ingest_log 커버리지 조회' },
      );
    } catch (e) {
      coverageError = e instanceof Error ? e.message : String(e);
    }
    if (coverageError) {
      step(false, 'ingest_log 월 커버리지', coverageError);
    } else {
      const months = recentMonths(WINDOW_MONTHS);
      const byRegion = new Map<string, Set<string>>();
      const rowsByRegion = new Map<string, number>();
      for (const r of data ?? []) {
        const code = r.lawd_cd as string;
        if (!byRegion.has(code)) byRegion.set(code, new Set());
        byRegion.get(code)!.add(r.deal_ym as string);
        rowsByRegion.set(code, (rowsByRegion.get(code) ?? 0) + Number(r.rows));
      }

      console.log('');
      console.log(`수집한 지역 ${byRegion.size}곳:`);
      let gaps = 0;
      for (const [code, have] of [...byRegion.entries()].sort()) {
        const missing = months.filter((m) => !have.has(m));
        const rows = rowsByRegion.get(code) ?? 0;
        const tail = missing.length
          ? `· 누락 ${missing.length}개월 (${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''})`
          : '· 빠진 달 없음';
        console.log(
          `  ${regionLabel(code).padEnd(18)} ${have.size}/${months.length}개월 · ${rows.toLocaleString('ko-KR')}행 ${tail}`,
        );
        if (missing.length) gaps++;
      }
      if (gaps > 0) {
        console.log(
          `  → 빠진 달이 있는 지역 ${gaps}곳. 해당 지역을 다시 조회하면 그 달만 받아 채웁니다.`,
        );
      }
    }
  }

  // 4) 적재량과 무료 티어 여유
  const rows = (counts.apt_trade ?? 0) + (counts.apt_rent ?? 0);
  const months = (counts.ingest_log ?? 0) + (counts.rent_ingest_log ?? 0);
  if (rows > 0 || months > 0) {
    const est = rows * BYTES_PER_ROW;
    const pctFree = (est / FREE_TIER_BYTES) * 100;
    console.log('');
    console.log(
      `적재 현황: 매매 ${(counts.apt_trade ?? 0).toLocaleString('ko-KR')}행 · ` +
        `전월세 ${(counts.apt_rent ?? 0).toLocaleString('ko-KR')}행 · ` +
        `수집한 (시군구×월) ${months.toLocaleString('ko-KR')}건`,
    );
    console.log(
      `테이블 추정 용량: 약 ${(est / 1024 / 1024).toFixed(1)}MB (무료 티어 500MB의 ${pctFree.toFixed(1)}%)`,
    );
    if (pctFree > 60) {
      console.log('⚠ 무료 티어의 60%를 넘었습니다. 조회 지역을 줄이거나 유료 플랜을 검토하세요.');
    }
  }

  console.log('');
  if (failed === 0) {
    console.log('Supabase 연결 정상 — 앱이 DB 모드로 동작합니다.');
    console.log('(화면 안내에서 "메모리 캐시 모드" 문구가 사라집니다.)');
  } else {
    console.log(`실패 ${failed}건 — 위 메시지를 확인하세요.`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

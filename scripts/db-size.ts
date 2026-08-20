/**
 * 실제 DB 용량 측정 — 추정치가 아니라 Postgres 가 보고하는 바이트를 읽는다.
 *
 *   npm run db:size
 *
 * .env.local 의 SUPABASE_DB_URL 을 쓴다. 대시보드 → Connect 에서
 * **Session pooler** 문자열을 쓰세요 (`aws-1-<region>.pooler.supabase.com`).
 * Direct 연결(`db.<ref>.supabase.co`)은 IPv6 전용이라 IPv4 환경에서 붙지 않습니다.
 */
import { Client } from 'pg';
import { loadEnv } from './env';

loadEnv();

const FREE_TIER_BYTES = 500 * 1024 * 1024;

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    console.error('SUPABASE_DB_URL 이 없습니다. .env.local 에 넣어주세요.');
    process.exit(1);
  }

  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`접속 실패: ${msg}`);
    if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
      console.error(
        [
          '',
          'Direct 연결(db.<ref>.supabase.co)은 IPv6 전용입니다. IPv4 환경에서는 붙지 않습니다.',
          '대시보드 → Connect → **Session pooler** 문자열로 바꿔주세요. 형태:',
          '  postgresql://postgres.<ref>:<비밀번호>@aws-1-<region>.pooler.supabase.com:5432/postgres',
        ].join('\n'),
      );
    }
    process.exit(1);
  }

  const total = await client.query<{ bytes: string }>(
    'select pg_database_size(current_database()) as bytes',
  );
  const totalBytes = Number(total.rows[0].bytes);

  const tables = await client.query<{
    relname: string;
    rows: string | null;
    table_bytes: string;
    index_bytes: string;
    total_bytes: string;
  }>(
    `select c.relname,
            s.n_live_tup as rows,
            pg_table_size(c.oid)   as table_bytes,
            pg_indexes_size(c.oid) as index_bytes,
            pg_total_relation_size(c.oid) as total_bytes
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      order by pg_total_relation_size(c.oid) desc`,
  );

  console.log(`DB 전체: ${mb(totalBytes)} / ${mb(FREE_TIER_BYTES)} ` +
    `(${((totalBytes / FREE_TIER_BYTES) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('테이블            행 수        데이터     인덱스     합계    행당');
  for (const r of tables.rows) {
    const rows = Number(r.rows ?? 0);
    const totalT = Number(r.total_bytes);
    const perRow = rows > 0 ? `${Math.round(totalT / rows)}B` : '—';
    console.log(
      `  ${r.relname.padEnd(16)}${rows.toLocaleString('ko-KR').padStart(10)}` +
        `${mb(Number(r.table_bytes)).padStart(11)}${mb(Number(r.index_bytes)).padStart(11)}` +
        `${mb(totalT).padStart(10)}${perRow.padStart(8)}`,
    );
  }

  // 지역 하나를 더 담을 수 있는지 — 실측 행당 크기로 계산
  const trade = tables.rows.find((r) => r.relname === 'apt_trade');
  const rent = tables.rows.find((r) => r.relname === 'apt_rent');
  const perRowBytes =
    trade && rent && Number(trade.rows) + Number(rent.rows) > 0
      ? (Number(trade.total_bytes) + Number(rent.total_bytes)) /
        (Number(trade.rows) + Number(rent.rows))
      : 450;

  console.log('');
  console.log(`실측 행당 평균: ${Math.round(perRowBytes)}B (capacity.ts 의 상수와 비교)`);
  const free = FREE_TIER_BYTES - totalBytes;
  // 실측: 지역당 매매 약 9,500행 + 전월세 약 9,000행
  const perRegion = 18_500 * perRowBytes;
  console.log(
    `남은 여유 ${mb(free)} → 지역 약 ${Math.floor(free / perRegion)}곳 더 담을 수 있습니다 ` +
      `(지역당 약 ${mb(perRegion)} 기준)`,
  );

  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Supabase 테이블 생성 — src/lib/schema.sql 을 그대로 실행한다.
 *
 *   npm run db:setup
 *
 * .env.local 의 SUPABASE_DB_URL (세션 풀러 연결 문자열)을 씁니다.
 * Supabase 대시보드 → Connect → Session pooler 에서 복사하고 [YOUR-PASSWORD] 를
 * 실제 DB 비밀번호로 바꿔 넣으세요.
 *
 * schema.sql 은 전부 `if not exists` 라서 여러 번 실행해도 안전합니다.
 * SQL Editor 에 직접 붙여넣어도 결과는 같습니다 — 이 스크립트는 편의용입니다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadEnv } from './env';

loadEnv();

/** schema.sql 이 만드는 표 전체 — 새 표를 넣으면 여기도 넣어야 보고에 나온다 */
const TABLES = [
  'apt_trade',
  'ingest_log',
  'apt_rent',
  'rent_ingest_log',
  'apt_kapt',
  'kapt_ingest_log',
];

async function main() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    console.error(
      [
        'SUPABASE_DB_URL 이 없습니다.',
        '',
        'Supabase 대시보드 → 프로젝트 → Connect → Session pooler 의 연결 문자열을',
        '.env.local 에 넣어주세요. 형태는 다음과 같습니다.',
        '',
        '  SUPABASE_DB_URL=postgresql://postgres.<project-ref>:<db-password>@aws-1-<region>.pooler.supabase.com:5432/postgres',
        '',
        '이 값이 없으면 src/lib/schema.sql 을 SQL Editor 에 붙여넣어 직접 실행해도 됩니다.',
      ].join('\n'),
    );
    process.exit(1);
  }
  if (url.includes('[YOUR-PASSWORD]') || url.includes('<db-password>')) {
    console.error('SUPABASE_DB_URL 의 비밀번호 자리가 아직 그대로입니다. 실제 값으로 바꿔주세요.');
    process.exit(1);
  }

  const sql = readFileSync(resolve('src/lib/schema.sql'), 'utf8');

  // 풀러는 자체 인증서를 쓰므로 검증을 끄고 TLS 만 사용한다.
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
  } catch (e) {
    console.error(`접속 실패: ${e instanceof Error ? e.message : String(e)}`);
    console.error('연결 문자열의 호스트·포트·비밀번호를 확인하세요 (세션 풀러는 5432 포트).');
    process.exit(1);
  }

  const before = await tableRows(client);

  try {
    await client.query(sql);
    console.log('schema.sql 실행 완료');
  } catch (e) {
    console.error(`SQL 실행 실패: ${e instanceof Error ? e.message : String(e)}`);
    await client.end();
    process.exit(1);
  }

  const after = await tableRows(client);
  console.log('');
  for (const t of TABLES) {
    const existed = before[t] !== undefined;
    const n = after[t];
    if (n === undefined) {
      console.log(`  ✗ ${t} — 생성되지 않았습니다`);
    } else {
      console.log(`  ✓ ${t} — ${existed ? '이미 있었음' : '새로 생성'} · 현재 ${n.toLocaleString('ko-KR')}행`);
    }
  }

  const size = await client.query(
    'select pg_size_pretty(pg_database_size(current_database())) as s',
  );
  console.log(`\n현재 DB 크기: ${size.rows[0].s}`);
  console.log('다음: npm run db:check 로 앱이 실제로 읽고 쓸 수 있는지 확인하세요.');

  await client.end();
}

async function tableRows(client: Client): Promise<Record<string, number>> {
  const { rows } = await client.query(
    `select c.relname, coalesce(s.n_live_tup, 0)::int as rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`,
    [TABLES],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.relname as string] = Number(r.rows);
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

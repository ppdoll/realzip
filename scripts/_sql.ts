import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { loadEnv } from './env';
loadEnv();
async function main() {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const t0 = Date.now();
  const r = await c.query(readFileSync(process.argv[2], 'utf8'));
  console.log(`소요 ${((Date.now()-t0)/1000).toFixed(2)}초`);
  for (const row of r.rows) console.log(row);
  await c.end();
}
main().catch(e => { console.error(e.message); process.exit(1) });

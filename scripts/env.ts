import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** .env.local → .env 순서로 읽어 process.env 에 채운다 (tsx 는 자동 로드하지 않는다). */
export function loadEnv(): void {
  for (const name of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key]) continue;
      process.env[key] = rawValue.trim().replace(/^["']|["']$/g, '');
    }
  }
}

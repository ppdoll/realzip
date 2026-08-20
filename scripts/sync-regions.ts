/**
 * 법정동코드 전체자료(txt) → src/data/regions.ts 재생성.
 *
 *   1. https://www.code.go.kr/stdcode/regCodeL.do 에서 "법정동코드 전체자료" 다운로드
 *   2. npm run sync:regions -- "C:/Users/…/법정동코드 전체자료.txt"
 *
 * 파일 형식: 탭 구분 "법정동코드<TAB>법정동명<TAB>폐지여부"
 * 인코딩은 EUC-KR 이 기본이며, --utf8 을 주면 UTF-8 로 읽는다.
 *
 * 일반구가 있는 시(수원/성남/창원 등)는 구 단위만 남긴다 —
 * 국토부 실거래가 API 가 구 코드를 요구하기 때문이다.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Row = { code5: string; sido: string; name: string };

function decode(buf: Buffer, utf8: boolean): string {
  if (utf8) return buf.toString('utf8');
  try {
    return new TextDecoder('euc-kr').decode(buf);
  } catch {
    console.warn('EUC-KR 디코더를 쓸 수 없어 UTF-8 로 읽습니다.');
    return buf.toString('utf8');
  }
}

function main() {
  const args = process.argv.slice(2);
  const utf8 = args.includes('--utf8');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('사용법: npm run sync:regions -- "<법정동코드 전체자료.txt>" [--utf8]');
    process.exit(2);
  }

  const text = decode(readFileSync(resolve(file)), utf8);
  const lines = text.split(/\r?\n/).slice(1); // 헤더 제거

  const rows: Row[] = [];
  for (const line of lines) {
    const [code, fullName, status] = line.split('\t').map((s) => s?.trim() ?? '');
    if (!code || !fullName) continue;
    if (status && !status.startsWith('존재')) continue;
    if (!/^\d{10}$/.test(code)) continue;
    // 시군구 레벨: 뒤 5자리가 00000 이고 시군구 3자리가 000 이 아닐 때
    if (!code.endsWith('00000')) continue;
    if (code.slice(2, 5) === '000') continue;

    const parts = fullName.split(/\s+/);
    if (parts.length < 2) continue;
    rows.push({
      code5: code.slice(0, 5),
      sido: parts[0],
      name: parts.slice(1).join(' '),
    });
  }

  // 하위 일반구를 가진 시는 제외 (예: "수원시" 는 빼고 "수원시 장안구" 만 남긴다)
  const bySido = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = bySido.get(r.sido);
    if (arr) arr.push(r);
    else bySido.set(r.sido, [r]);
  }
  const kept: Row[] = [];
  for (const [, list] of bySido) {
    for (const r of list) {
      const hasChildGu = list.some((o) => o !== r && o.name.startsWith(`${r.name} `));
      if (!hasChildGu) kept.push(r);
    }
  }
  kept.sort((a, b) => a.code5.localeCompare(b.code5));

  const body = kept
    .map((r) => `  { code: '${r.code5}', sido: '${r.sido}', name: '${r.name}' },`)
    .join('\n');

  const out = `/**
 * 법정동코드 시군구(5자리) 목록 — 국토부 실거래가 API의 LAWD_CD 파라미터 값.
 * scripts/sync-regions.ts 로 자동 생성됨. 손으로 고치지 말 것.
 *
 * 코드가 개편된 지역(강원 42→51, 전북 45→52)의 legacy 폴백은
 * 재생성 시 사라지므로, 필요하면 아래에 다시 붙여넣어야 한다.
 */
export type Region = {
  code: string;
  sido: string;
  name: string;
  legacy?: string;
};

export const REGIONS: Region[] = [
${body}
];

export const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

export function regionLabel(code: string): string {
  const r = REGION_BY_CODE.get(code);
  return r ? \`\${r.sido} \${r.name}\` : code;
}

export function regionsBySido(): { sido: string; regions: Region[] }[] {
  const order: string[] = [];
  const map = new Map<string, Region[]>();
  for (const r of REGIONS) {
    if (!map.has(r.sido)) {
      map.set(r.sido, []);
      order.push(r.sido);
    }
    map.get(r.sido)!.push(r);
  }
  return order.map((sido) => ({ sido, regions: map.get(sido)! }));
}
`;

  const target = resolve('src/data/regions.ts');
  writeFileSync(target, out, 'utf8');
  console.log(`${kept.length}개 시군구를 ${target} 에 썼습니다.`);
  console.log('강원/전북 등 코드 개편 지역의 legacy 폴백은 다시 넣어주세요.');
}

main();

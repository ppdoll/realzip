import { markPng } from '@/lib/mark';

/** /icon-512.png — 매니페스트가 가리키는 앱 아이콘 */
export const dynamic = 'force-static';

export function GET() {
  return markPng(512, 0);
}

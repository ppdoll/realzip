import { NextResponse } from 'next/server';
import { regionsBySido } from '@/data/regions';

export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json({ sido: regionsBySido() });
}

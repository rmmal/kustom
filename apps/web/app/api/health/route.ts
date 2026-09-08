import { NextResponse } from 'next/server';
import { healthResponseSchema } from './schema';

export const dynamic = 'force-dynamic';

/**
 * Liveness probe. Deliberately says nothing about the database or the companion tokens:
 * it exists so a deploy can be checked without authenticating.
 */
export function GET() {
  const body = healthResponseSchema.parse({
    ok: true,
    service: 'customs-night',
    time: new Date().toISOString(),
  });

  return NextResponse.json(body);
}

import type { NextResponse } from 'next/server';
import { ackRoute } from '../settle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The command ran and this is what came back (M4.1). Rules and refusals: `../settle.ts`. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  return ackRoute(id)(request);
}

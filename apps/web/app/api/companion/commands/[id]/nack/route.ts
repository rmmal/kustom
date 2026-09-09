import type { NextResponse } from 'next/server';
import { nackRoute } from '../settle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The command did not run, or ran and was refused (M4.1). `retryable: true` means nothing
 * happened at all and the row goes back to `pending`. Rules and refusals: `../settle.ts`.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await context.params;
  return nackRoute(id)(request);
}

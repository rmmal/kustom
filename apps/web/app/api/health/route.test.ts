import { describe, expect, it } from 'vitest';
import { GET } from './route';
import { healthResponseSchema } from './schema';

describe('GET /api/health', () => {
  it('returns a body that matches its response schema', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(healthResponseSchema.safeParse(await response.json()).success).toBe(true);
  });
});

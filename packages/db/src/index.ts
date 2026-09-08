/**
 * `packages/db` owns the Supabase migrations, the generated database types and the zod
 * schemas shared by the API, the companion and the bot.
 *
 * M1.2 lands `supabase/migrations/0001_init.sql`, regenerates `src/types.ts` and fills
 * `src/schemas/`. Import boundary schemas from `@customs/db/schemas`.
 */

export * from './schemas/index.js';
export type { Database, Json } from './types.js';

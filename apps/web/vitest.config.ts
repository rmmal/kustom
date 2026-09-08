import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'lib/**/*.test.ts'],
    /*
     * One test file at a time.
     *
     * The integration files (`*.integration.test.ts`) all talk to the *same* Supabase local
     * stack, and some of the state they touch is global to that database rather than
     * namespaceable: there is exactly one active season, and `games.season_id` defaults to it.
     * Run in parallel workers, the admin file's "start a season" test moves the active season
     * out from under the companion file's game ingest, which then fails with a null
     * `season_id`. Namespacing rows cannot fix a singleton.
     *
     * The whole suite is about a second, so serialising every file costs nothing and removes a
     * class of flake that only shows up on some runs.
     */
    fileParallelism: false,
  },
});

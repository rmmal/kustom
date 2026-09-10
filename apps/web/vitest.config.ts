import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('.', import.meta.url)) };

export default defineConfig({
  test: {
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
     *
     * **It has to be set on every project, not only here** (2026-09-11, M5.7). With `projects`
     * defined, this root-level value does not reach them: `vitest run lib/ingest lib/board`
     * ran the rebuild's file beside `roles.integration.test.ts`, which posted its ten players'
     * games into the season `start_season` had just made active, and the rebuild then folded
     * twenty players and nine games it had never heard of. Adding one file was enough to
     * change the scheduling and make it show. `--no-file-parallelism` on the command line is
     * the same switch; nobody should have to remember it.
     */
    fileParallelism: false,

    /*
     * Two projects, because component tests need a DOM and nothing else does (M3.4).
     *
     * `node` is what has always run here: route handlers, the ingest, the embeds, the
     * integration files against the local stack. It keeps the node environment, because a
     * jsdom global `fetch`/`Response` under a route handler test would be testing a different
     * runtime than Vercel runs.
     *
     * `dom` is the `.test.tsx` files only, under jsdom, for the tonight page's components. The split
     * is by extension rather than by directory so a `.tsx` test cannot end up in the wrong
     * environment by living in the wrong folder.
     */
    projects: [
      {
        resolve: { alias },
        // The integration file renders the page's components to a string to check the first
        // paint, so the node project needs the same JSX transform the dom one does.
        oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
        test: {
          name: 'node',
          environment: 'node',
          include: ['app/**/*.test.ts', 'lib/**/*.test.ts'],
          fileParallelism: false,
        },
      },
      {
        resolve: { alias },
        /*
         * The app's `tsconfig.json` sets `jsx: preserve`, because Next compiles the JSX. A
         * test file has no Next in front of it, so the test runner has to do that transform
         * itself: without this the `.tsx` files reach the bundler as JSX and fail to parse.
         */
        oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx', 'lib/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.tsx'],
          fileParallelism: false,
        },
      },
    ],
  },
});

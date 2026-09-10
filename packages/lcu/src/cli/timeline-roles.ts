/**
 * `pnpm --filter @customs/lcu timeline-roles [--patch 16.17] [--out <dir>]`
 *
 * The M5.18 cross-check, run over the saved fixtures: every match-history game (`match-detail*.json`, the
 * games of `match-history*.json`) against every live end-of-game capture (`eog-stats-block*.json`, the eog
 * `Create`/`Update` events of `ws-events*.ndjson`) of the same `gameId`, participant by participant. Prints the
 * confusion table `docs/03-lcu-reference.md` carries and the list of every pair seen; exits 1 when a pair in
 * `MATCH_TIMELINE_ROLES` disagreed with a live position, which is the one thing that must never be committed.
 *
 * No client, no network: this is what to run after `smoke --game-id <ids>` has saved the details of a night
 * whose end-of-game blocks `record-ws` (or the companion) captured.
 */

import { parseArgs } from 'node:util';
import { FIXTURES_DIR, listPatchDirs } from '../fixtures.js';
import {
  crossCheckTimelineRoles,
  formatTimelineConfusion,
  MATCH_TIMELINE_ROLES,
  readTimelineEvidence,
} from '../timelineRoles.js';

const HELP = `timeline-roles: cross-check match-history timeline.lane/role against live detectedTeamPosition, from fixtures.

  --patch <p>   fixture directory to read (default: the newest under the root)
  --out <dir>   fixtures root (default packages/lcu/fixtures)
`;

function main(): number {
  const { values } = parseArgs({
    options: {
      patch: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const root = values.out ?? FIXTURES_DIR;
  const patch = values.patch ?? listPatchDirs(root)[0];
  if (patch === undefined) {
    console.error(`no patch directory under ${root}`);
    return 2;
  }

  const evidence = readTimelineEvidence(patch, root);
  const check = crossCheckTimelineRoles(evidence.games, evidence.blocks);
  const gameIds = new Set(evidence.games.map((game) => game.gameId));
  const blockIds = new Set(evidence.blocks.map((block) => block.gameId));

  console.log(`patch ${patch}: ${evidence.files.length} files read (${evidence.files.join(', ')})`);
  console.log(
    `${gameIds.size} match-history games, ${blockIds.size} live end-of-game captures, ${check.overlappingGameIds.length} in both${
      check.overlappingGameIds.length > 0 ? ` (${check.overlappingGameIds.join(', ')})` : ''
    }, ${check.observations.length} overlapping participants`,
  );
  console.log('');
  console.log(`table in code (MATCH_TIMELINE_ROLES): ${JSON.stringify(MATCH_TIMELINE_ROLES)}`);
  console.log('');
  console.log(
    check.rows.length > 0
      ? formatTimelineConfusion(check.rows)
      : '(no overlapping participant: nothing to cross-check)',
  );
  console.log('');
  console.log('pairs seen in match-history games (all, overlapping or not):');
  for (const [pair, count] of Object.entries(check.pairsSeen).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(
      `  ${pair.padEnd(18)} ${String(count).padStart(3)}  -> ${MATCH_TIMELINE_ROLES[pair] ?? 'null'}`,
    );
  }

  const contradicted = check.rows.filter((row) => row.disagreed > 0);
  if (contradicted.length > 0) {
    console.error('');
    console.error(
      `MAPPED PAIR CONTRADICTED BY A LIVE CAPTURE: ${contradicted.map((row) => row.pair).join(', ')} -- remove it from MATCH_TIMELINE_ROLES`,
    );
    return 1;
  }
  return 0;
}

process.exitCode = main();

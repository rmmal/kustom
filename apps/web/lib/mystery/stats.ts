import type { MysteryCommunity, MysteryGuessShare, MysteryPercentileBucket } from './types';

/**
 * Anonymous community numbers for one challenge. No visitor names. Percentile ranks
 * correct guesses by fewer clues, then faster time. Under 10 correct answers there
 * is no percentile — a top-5% of four people is noise.
 */

export const MYSTERY_PERCENTILE_MIN_CORRECT = 10;

export interface AttemptStat {
  visitorId: string;
  guessedPlayerId: string;
  guessedName: string;
  correct: boolean;
  cluesUsed: number;
  completionTimeMs: number;
}

export function compareCorrect(a: AttemptStat, b: AttemptStat): number {
  if (a.cluesUsed !== b.cluesUsed) return a.cluesUsed - b.cluesUsed;
  if (a.completionTimeMs !== b.completionTimeMs) return a.completionTimeMs - b.completionTimeMs;
  return a.visitorId < b.visitorId ? -1 : a.visitorId > b.visitorId ? 1 : 0;
}

export function percentileBucket(rank: number, total: number): MysteryPercentileBucket | null {
  if (total < MYSTERY_PERCENTILE_MIN_CORRECT || rank < 1 || rank > total) return null;
  const fraction = rank / total;
  if (fraction <= 0.05) return 'top-5';
  if (fraction <= 0.1) return 'top-10';
  if (fraction <= 0.15) return 'top-15';
  if (fraction <= 0.25) return 'top-25';
  if (fraction <= 0.5) return 'top-50';
  return null;
}

export function rankAmongCorrect(attempt: AttemptStat, correct: readonly AttemptStat[]): number {
  const ordered = [...correct].sort(compareCorrect);
  const index = ordered.findIndex((row) => row.visitorId === attempt.visitorId);
  return index === -1 ? correct.length + 1 : index + 1;
}

export function buildCommunity(
  attempts: readonly AttemptStat[],
  firstDetectiveClaimed: boolean,
): MysteryCommunity {
  const correctRows = attempts.filter((row) => row.correct);
  const wrongRows = attempts.filter((row) => !row.correct);
  const attemptsN = attempts.length;
  const correct = correctRows.length;
  const wrong = wrongRows.length;
  const accuracyPercent = attemptsN === 0 ? 0 : (correct / attemptsN) * 100;
  const cluesSum = attempts.reduce((sum, row) => sum + row.cluesUsed, 0);
  const fastest = correctRows.reduce<number | null>(
    (best, row) => (best === null || row.completionTimeMs < best ? row.completionTimeMs : best),
    null,
  );

  const counts = new Map<string, { name: string; count: number }>();
  for (const row of attempts) {
    const current = counts.get(row.guessedPlayerId);
    if (current === undefined) counts.set(row.guessedPlayerId, { name: row.guessedName, count: 1 });
    else current.count += 1;
  }
  const distribution: MysteryGuessShare[] = [...counts.entries()]
    .map(([playerId, row]) => ({
      playerId,
      name: row.name,
      count: row.count,
      percent: attemptsN === 0 ? 0 : Math.round((row.count / attemptsN) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const wrongCounts = new Map<string, { name: string; count: number }>();
  for (const row of wrongRows) {
    const current = wrongCounts.get(row.guessedPlayerId);
    if (current === undefined) wrongCounts.set(row.guessedPlayerId, { name: row.guessedName, count: 1 });
    else current.count += 1;
  }
  let mostFalselyAccused: MysteryCommunity['mostFalselyAccused'] = null;
  for (const [playerId, row] of wrongCounts) {
    if (
      mostFalselyAccused === null ||
      row.count > mostFalselyAccused.count ||
      (row.count === mostFalselyAccused.count && row.name < mostFalselyAccused.name)
    ) {
      mostFalselyAccused = { playerId, name: row.name, count: row.count };
    }
  }

  return {
    attempts: attemptsN,
    correct,
    wrong,
    accuracyPercent,
    wrongPercent: attemptsN === 0 ? 0 : (wrong / attemptsN) * 100,
    averageCluesUsed: attemptsN === 0 ? null : cluesSum / attemptsN,
    zeroClueCorrect: correctRows.filter((row) => row.cluesUsed === 0).length,
    fastestCorrectMs: fastest,
    mostFalselyAccused,
    distribution,
    firstDetectiveClaimed,
  };
}

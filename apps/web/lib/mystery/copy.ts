import type { MysteryCategory, MysteryClueType, MysteryPercentileBucket } from './types';

/**
 * Every sentence Daily Mystery says, in Floodlit's voice: plain nouns, real numbers, no
 * emoji, no "EPIC", no named leaderboard. The visitor is anonymous. The League player is
 * the one we are exposing.
 */

export const MYSTERY_LABEL = 'Mystery';

export const MYSTERY_TITLE = 'Daily Mystery';

export const MYSTERY_CRIME = 'The crime';

export const MYSTERY_WHO = 'Who was it?';

export const MYSTERY_GUESS = 'Guess now';

export const MYSTERY_REVEAL = 'Reveal another clue';

export const MYSTERY_REVEAL_FIRST = 'Reveal a clue';

export const MYSTERY_NEED_HELP = 'Need help?';

export const MYSTERY_LOCKED = 'Locked in';

export const MYSTERY_CASE_CLOSED = 'Case closed';

export const MYSTERY_TODAY_CLOSED = "Today's case is closed";

export const MYSTERY_NEXT = 'Next mystery';

export const MYSTERY_CORRECT = 'Correct';

export const MYSTERY_WRONG = 'Wrong';

export const MYSTERY_FIRST = 'First detective';

export const MYSTERY_FIRST_TAKEN = "Someone has already claimed today's First Detective.";

export const MYSTERY_BLAME = 'Who did everyone blame?';

export const MYSTERY_YOUR_RESULT = 'Your result';

export const MYSTERY_COMMUNITY = "Today's community";

export const MYSTERY_EMPTY = 'No customs to expose yet. Play a few and the first mystery writes itself.';

export const MYSTERY_SHARE = 'Copy result';

export const MYSTERY_SHARE_DONE = 'Copied';

export function mysteryHeading(challengeNumber: number): string {
  return `${MYSTERY_TITLE} #${challengeNumber}`;
}

export function mysterySomeoneLine(): string {
  return 'Someone in our customs went';
}

export function kdaLine(kills: number, deaths: number, assists: number): string {
  return `${kills} / ${deaths} / ${assists}`;
}

export function lockInLine(name: string): string {
  return `Lock in ${name}`;
}

export function itWasLine(name: string): string {
  return `It was ${name}`;
}

export function youGuessedLine(name: string): string {
  return `You guessed ${name}.`;
}

export function categoryLabel(category: MysteryCategory): string {
  switch (category) {
    case 'disaster':
      return 'Disaster class';
    case 'monster':
      return 'Monster game';
    case 'farming':
      return 'Farming simulator';
    case 'raid_boss':
      return 'Raid boss';
    case 'ghost':
      return 'Where were you?';
  }
}

export function clueTypeLabel(type: MysteryClueType): string {
  switch (type) {
    case 'champion':
      return 'Champion';
    case 'role':
      return 'Role';
    case 'damage':
      return 'Damage';
    case 'cs':
      return 'CS';
    case 'gold':
      return 'Gold';
    case 'damage_taken':
      return 'Damage taken';
    case 'longest_life':
      return 'Longest life';
    case 'historical':
      return 'History';
  }
}

export function roleWord(role: string): string {
  return role.toUpperCase();
}

export function historicalChampLine(champion: string, times: number): string {
  return times === 1
    ? `This player has picked ${champion} once in our customs.`
    : `This player has picked ${champion} ${times} times in our customs.`;
}

export function historicalGamesLine(games: number): string {
  return games === 1
    ? 'This player has one custom on the board.'
    : `This player has ${games} customs on the board.`;
}

export function percentileLabel(bucket: MysteryPercentileBucket): string {
  switch (bucket) {
    case 'top-5':
      return 'Top 5%';
    case 'top-10':
      return 'Top 10%';
    case 'top-15':
      return 'Top 15%';
    case 'top-25':
      return 'Top 25%';
    case 'top-50':
      return 'Top 50%';
  }
}

export function cluesUsedLine(count: number): string {
  if (count === 0) return 'You solved it with zero clues.';
  if (count === 1) return 'You solved it with 1 clue.';
  return `You solved it with ${count} clues.`;
}

export function cluesUsedShort(count: number): string {
  return count === 1 ? '1 clue' : `${count} clues`;
}

export function firstDetectiveYou(): string {
  return 'You are the first person today to solve the mystery correctly.';
}

export function notAloneWrong(others: number): string {
  if (others <= 0) return 'You were the first wrong guess today.';
  if (others === 1) return 'You were not alone. 1 other guess was wrong today.';
  return `You were not alone. ${others} other guesses were wrong today.`;
}

export function fooledLine(wrongPercent: number): string {
  return `${wrongPercent.toFixed(1)}% of today's detectives were fooled.`;
}

export function mostAccusedLine(name: string): string {
  return `Most falsely accused: ${name}`;
}

export function yourGuessLine(name: string): string {
  return `Your guess: ${name}`;
}

export function actualPlayerLine(name: string): string {
  return `Actual player: ${name}`;
}

export function communityAccuracyLine(percent: number): string {
  return `Current community accuracy: ${percent.toFixed(0)}%`;
}

export function attemptsSoFarLine(count: number): string {
  return count === 1 ? '1 attempt so far' : `${count} attempts so far`;
}

export function solvedInLine(ms: number): string {
  const seconds = ms / 1_000;
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`;
  return `${Math.round(seconds)} seconds`;
}

export function shareSolved(
  challengeNumber: number,
  cluesUsed: number,
  bucket: MysteryPercentileBucket | null,
): string {
  const clues = cluesUsed === 0 ? 'zero clues' : cluesUsed === 1 ? '1 clue' : `${cluesUsed} clues`;
  const rank = bucket === null ? '' : ` ${percentileLabel(bucket)}.`;
  return `Daily Mystery #${challengeNumber} — solved with ${clues}.${rank}`;
}

export function shareMissed(challengeNumber: number): string {
  return `Daily Mystery #${challengeNumber} — missed it. Tomorrow's another case.`;
}

export const HOOK_DEATHS = 'Deaths';
export const HOOK_KP = 'Kill participation';
export const HOOK_CS = 'CS';
export const HOOK_DURATION = 'Game';
export const HOOK_DAMAGE_TAKEN = 'Damage taken';
export const HOOK_DAMAGE = 'Damage';

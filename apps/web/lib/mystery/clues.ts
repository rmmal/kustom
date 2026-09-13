import type { RoleValue } from '@customs/db';
import { formatDamage, formatDuration } from '../discord/embeds';
import {
  clueTypeLabel,
  HOOK_CS,
  HOOK_DAMAGE,
  HOOK_DAMAGE_TAKEN,
  HOOK_DEATHS,
  HOOK_DURATION,
  HOOK_KP,
  historicalChampLine,
  historicalGamesLine,
  roleWord,
} from './copy';
import type { MysteryCategory, MysteryClueType, MysteryClueView, MysteryHookLine } from './types';

/**
 * Progressive clues, built once when the day is created and stored server-side.
 * The public GET never receives these values. Each POST returns the next row only.
 */

export interface ClueSource {
  category: MysteryCategory;
  champion: string | null;
  role: RoleValue | null;
  damage: number;
  cs: number;
  gold: number;
  damageTaken: number | null;
  longestLivedS: number | null;
  championTimes: number | null;
  gamesPlayed: number;
}

export interface StoredClue {
  type: MysteryClueType;
  value: string;
  revealOrder: number;
}

export function buildStoredClues(source: ClueSource): StoredClue[] {
  const rows: StoredClue[] = [];
  const push = (type: MysteryClueType, value: string | null): void => {
    if (value === null || value.trim() === '') return;
    rows.push({ type, value, revealOrder: rows.length + 1 });
  };

  push('champion', source.champion);
  push('role', source.role === null ? null : roleWord(source.role));
  if (source.category === 'farming') {
    push('cs', String(source.cs));
    push('damage', formatDamage(source.damage));
  } else if (source.category === 'raid_boss' && source.damageTaken !== null) {
    push('damage_taken', formatDamage(source.damageTaken));
    push('damage', formatDamage(source.damage));
  } else {
    push('damage', formatDamage(source.damage));
    push('cs', String(source.cs));
  }
  push('gold', formatDamage(source.gold));
  if (source.longestLivedS !== null && source.longestLivedS > 0) {
    push('longest_life', formatDuration(source.longestLivedS));
  }

  const historical =
    source.champion !== null && source.championTimes !== null && source.championTimes > 0
      ? historicalChampLine(source.champion, source.championTimes)
      : source.gamesPlayed > 0
        ? historicalGamesLine(source.gamesPlayed)
        : null;
  const capped = rows.slice(0, historical === null ? 5 : 4);
  if (historical !== null) {
    capped.push({ type: 'historical', value: historical, revealOrder: capped.length + 1 });
  }
  return capped;
}

export function clueView(clue: StoredClue): MysteryClueView {
  return {
    order: clue.revealOrder,
    type: clue.type,
    label: clueTypeLabel(clue.type),
    value: clue.value,
  };
}

export function hookLines(input: {
  category: MysteryCategory;
  deaths: number;
  kp: number | null;
  cs: number;
  damage: number;
  damageTaken: number | null;
  durationS: number;
}): MysteryHookLine[] {
  const duration = { label: HOOK_DURATION, value: formatDuration(input.durationS) };
  switch (input.category) {
    case 'disaster':
      return [
        { label: HOOK_DEATHS, value: String(input.deaths) },
        ...(input.kp === null ? [] : [{ label: HOOK_KP, value: `${input.kp}%` }]),
        duration,
      ];
    case 'monster':
      return [
        ...(input.kp === null ? [] : [{ label: HOOK_KP, value: `${input.kp}%` }]),
        { label: HOOK_DAMAGE, value: formatDamage(input.damage) },
        duration,
      ];
    case 'farming':
      return [{ label: HOOK_CS, value: String(input.cs) }, duration];
    case 'raid_boss':
      return [
        ...(input.damageTaken === null
          ? []
          : [{ label: HOOK_DAMAGE_TAKEN, value: formatDamage(input.damageTaken) }]),
        duration,
      ];
    case 'ghost':
      return [{ label: HOOK_DAMAGE, value: formatDamage(input.damage) }, duration];
  }
}

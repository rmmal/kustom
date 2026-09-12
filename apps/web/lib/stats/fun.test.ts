import { describe, expect, it } from 'vitest';
import { rosterFor, statsGame, tenPlayerGame } from '../testing/statsFixtures';
import { funFactsView } from './fun';
import { FIRST_BLOOD_EMPTY, FIRST_BLOOD_NOTE, VISION_NOTE } from './funCopy';

function loudLena() {
  return tenPlayerGame({
    at: '2026-09-02T20:00:00Z',
    durationS: 1_800,
    winner: 100,
    blue: [
      {
        key: 'lena',
        role: 'adc',
        kills: 18,
        deaths: 2,
        assists: 9,
        cs: 280,
        damageToChamps: 32_000,
        gold: 16_000,
      },
      {
        key: 'iris',
        role: 'top',
        kills: 4,
        deaths: 5,
        assists: 6,
        cs: 190,
        damageToChamps: 14_000,
        gold: 11_000,
      },
      {
        key: 'rami',
        role: 'jungle',
        kills: 6,
        deaths: 4,
        assists: 12,
        cs: 160,
        damageToChamps: 12_000,
        gold: 12_000,
      },
      {
        key: 'omar',
        role: 'mid',
        kills: 8,
        deaths: 3,
        assists: 7,
        cs: 220,
        damageToChamps: 18_000,
        gold: 13_000,
      },
      {
        key: 'theo',
        role: 'support',
        kills: 1,
        deaths: 6,
        assists: 20,
        cs: 40,
        damageToChamps: 4_000,
        gold: 8_000,
      },
    ],
    red: [
      {
        key: 'yuki',
        role: 'adc',
        kills: 2,
        deaths: 11,
        assists: 1,
        cs: 90,
        damageToChamps: 6_000,
        gold: 9_000,
      },
      {
        key: 'nadia',
        role: 'top',
        kills: 3,
        deaths: 7,
        assists: 2,
        cs: 140,
        damageToChamps: 8_000,
        gold: 9_500,
      },
      {
        key: 'karim',
        role: 'jungle',
        kills: 1,
        deaths: 8,
        assists: 3,
        cs: 80,
        damageToChamps: 5_000,
        gold: 8_500,
      },
      {
        key: 'hana',
        role: 'mid',
        kills: 4,
        deaths: 6,
        assists: 2,
        cs: 150,
        damageToChamps: 9_000,
        gold: 10_000,
      },
      {
        key: 'bilal',
        role: 'support',
        kills: 0,
        deaths: 9,
        assists: 4,
        cs: 18,
        damageToChamps: 2_000,
        gold: 7_000,
      },
    ],
  });
}

describe('funFactsView', () => {
  it('uses the same counted-game gate as /stats — a remake is not a record', () => {
    const remake = statsGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 120,
      blue: ['lena:adc', 'iris:top', 'rami:jungle', 'omar:mid', 'theo:support'],
      red: ['yuki:adc', 'nadia:top', 'karim:jungle', 'hana:mid', 'bilal:support'],
    });
    const facts = funFactsView([remake], rosterFor([remake]));
    expect(facts.games).toBe(0);
    expect(facts.records.find((record) => record.id === 'kills')?.holders).toEqual([]);
  });

  it('names the highest and lowest CS at a role in one counted game', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    const adc = facts.csByRole.find((pair) => pair.role === 'adc');
    expect(adc?.highest?.name).toBe('Lena');
    expect(adc?.highest?.valueLabel).toContain('280 CS');
    expect(adc?.lowest?.name).toBe('Yuki');
  });

  it('crowns one-game combat records from the stored scoreboard', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.records.find((record) => record.id === 'kills')?.holders[0]?.name).toBe('Lena');
    expect(facts.records.find((record) => record.id === 'deaths')?.holders[0]?.name).toBe('Yuki');
    expect(facts.records.find((record) => record.id === 'assists')?.holders[0]?.name).toBe('Theo');
    expect(facts.records.find((record) => record.id === 'damage')?.holders[0]?.name).toBe('Lena');
  });

  it('does not invent first blood or vision — those columns are not stored', () => {
    const game = loudLena();
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.tables[0]?.rows).toEqual([]);
    expect(facts.tables[0]?.empty).toBe(FIRST_BLOOD_EMPTY);
    expect(facts.notes).toEqual([FIRST_BLOOD_NOTE, VISION_NOTE]);
  });

  it('names a fountain resident only when CS and takedowns are both that low', () => {
    const farmed = { kills: 4, deaths: 3, assists: 5, cs: 180 };
    const game = tenPlayerGame({
      at: '2026-09-02T20:00:00Z',
      durationS: 1_400,
      winner: 100,
      blue: [
        { key: 'lena', role: 'adc', kills: 0, deaths: 4, assists: 1, cs: 12 },
        { key: 'iris', role: 'top', ...farmed },
        { key: 'rami', role: 'jungle', ...farmed },
        { key: 'omar', role: 'mid', ...farmed },
        { key: 'theo', role: 'support', ...farmed },
      ],
      red: [
        { key: 'yuki', role: 'adc', ...farmed },
        { key: 'nadia', role: 'top', ...farmed },
        { key: 'karim', role: 'jungle', ...farmed },
        { key: 'hana', role: 'mid', ...farmed },
        { key: 'bilal', role: 'support', ...farmed },
      ],
    });
    const facts = funFactsView([game], rosterFor([game]));
    expect(facts.records.find((record) => record.id === 'fountain')?.holders[0]?.name).toBe('Lena');
  });
});

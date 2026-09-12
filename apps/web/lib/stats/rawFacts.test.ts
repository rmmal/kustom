import { describe, expect, it } from 'vitest';
import { emptyRawFacts, rawFactsFromUnknown } from './rawFacts';

describe('rawFactsFromUnknown', () => {
  it('is empty on junk', () => {
    expect(rawFactsFromUnknown(null)).toEqual(emptyRawFacts());
    expect(rawFactsFromUnknown('nope')).toEqual(emptyRawFacts());
    expect(rawFactsFromUnknown({ gameMode: 'CLASSIC' })).toEqual(emptyRawFacts());
  });

  it('reads first blood, steals and the champion name off an end-of-game block', () => {
    const facts = rawFactsFromUnknown({
      gameMode: 'CLASSIC',
      teams: [
        {
          teamId: 100,
          players: [
            {
              puuid: 'u-lena',
              championName: 'Ahri',
              stats: {
                firstBloodKill: 1,
                firstBloodAssist: 0,
                VISION_SCORE: 22,
                objectivesStolen: 2,
                baronKills: 1,
                dragonKills: 0,
                longestTimeSpentLiving: 640,
              },
            },
          ],
        },
        {
          teamId: 200,
          players: [
            {
              puuid: 'u-yuki',
              championName: 'Yasuo',
              stats: { firstBloodKill: 0, firstBloodAssist: 0, objectivesStolen: 0 },
            },
            { puuid: '00000000-0000-0000-0000-000000000000', stats: { firstBloodKill: 1 } },
          ],
        },
      ],
    });

    expect(facts.byPuuid['u-lena']?.firstBloodKill).toBe(true);
    expect(facts.byPuuid['u-lena']?.objectivesStolen).toBe(2);
    expect(facts.byPuuid['u-lena']?.championName).toBe('Ahri');
    expect(facts.byPuuid['u-lena']?.longestLivedS).toBe(640);
    expect(facts.byPuuid['u-yuki']?.firstBloodKill).toBe(false);
    expect(facts.byPuuid['00000000-0000-0000-0000-000000000000']).toBeUndefined();
  });

  it('reads first blood and draft bans off a match-history detail', () => {
    const facts = rawFactsFromUnknown({
      participantIdentities: [
        { participantId: 1, player: { puuid: 'u-omar' } },
        { participantId: 6, player: { puuid: 'u-hana' } },
      ],
      participants: [
        { participantId: 1, teamId: 100, stats: { firstBloodKill: false, visionScore: 40 } },
        { participantId: 6, teamId: 200, stats: { firstBloodKill: true, objectivesStolen: 1 } },
      ],
      teams: [
        {
          teamId: 100,
          bans: [
            { championId: 35, pickTurn: 1 },
            { championId: -1, pickTurn: 2 },
          ],
        },
        { teamId: 200, bans: [{ championId: 103, pickTurn: 6 }] },
      ],
    });

    expect(facts.byPuuid['u-hana']?.firstBloodKill).toBe(true);
    expect(facts.byPuuid['u-omar']?.visionScore).toBe(40);
    expect(facts.bans).toEqual([
      { championId: 35, teamId: 100 },
      { championId: 103, teamId: 200 },
    ]);
  });
});

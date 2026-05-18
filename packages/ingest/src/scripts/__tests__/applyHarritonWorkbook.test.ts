import { describe, expect, it } from 'vitest';
import {
  normalizeWorkbookToken,
  parseFaceoff,
  pickOpponentGroupForSheet,
  resolvePlayerName,
  type OpponentGroup,
  type PlayerSeed,
} from '../applyHarritonWorkbook.js';

describe('applyHarritonWorkbook helpers', () => {
  it('normalizes workbook sheet tokens', () => {
    expect(normalizeWorkbookToken('New Hope S')).toBe('newhopes');
    expect(normalizeWorkbookToken('CardinalO')).toBe('cardinalo');
    expect(normalizeWorkbookToken('CB South')).toBe('cbsouth');
  });

  it('parses faceoff cells from ratio and scalar forms', () => {
    expect(parseFaceoff('22/33')).toEqual({ won: 22, taken: 33 });
    expect(parseFaceoff(' 7 ')).toEqual({ won: 7, taken: 0 });
    expect(parseFaceoff(5)).toEqual({ won: 5, taken: 0 });
  });

  it('maps a sheet to one unique opponent when confidence is high', () => {
    const groups: OpponentGroup[] = [
      {
        opponentTeamId: 1,
        opponentName: "Cardinal O'Hara",
        games: [{ gameId: 100, date: '2026-03-19', season: 2026 }],
        tokens: new Set(['cardinalohara', 'cardinalo', 'cohara']),
      },
      {
        opponentTeamId: 2,
        opponentName: 'Upper Darby',
        games: [{ gameId: 200, date: '2026-04-09', season: 2026 }],
        tokens: new Set(['upperdarby', 'ud']),
      },
    ];
    const pick = pickOpponentGroupForSheet('CardinalO', groups);
    expect(pick.group?.opponentName).toBe("Cardinal O'Hara");
    expect(pick.reason).toBeUndefined();
    expect(pick.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('skips mapping when one opponent has multiple games', () => {
    const groups: OpponentGroup[] = [
      {
        opponentTeamId: 1,
        opponentName: 'Upper Merion',
        games: [
          { gameId: 10, date: '2026-04-07', season: 2026 },
          { gameId: 11, date: '2026-05-06', season: 2026 },
        ],
        tokens: new Set(['uppermerion']),
      },
    ];
    const pick = pickOpponentGroupForSheet('Upper Merion', groups);
    expect(pick.group).toBeUndefined();
    expect(pick.reason).toContain('multiple games');
  });

  it('resolves exact and alias player matches', () => {
    const players: PlayerSeed[] = [
      {
        id: 50907,
        name: 'Peirce Merrill',
        normalized: 'peirce merrill',
        firstInitial: 'p',
        lastToken: 'merrill',
        statRows: 8,
      },
      {
        id: 54125,
        name: 'Yusef Abbas',
        normalized: 'yusef abbas',
        firstInitial: 'y',
        lastToken: 'abbas',
        statRows: 3,
      },
    ];
    const exact = resolvePlayerName('Peirce Merrill', players);
    expect(exact.kind).toBe('existing');
    expect(exact.playerId).toBe(50907);

    const alias = resolvePlayerName('Merrill', players);
    expect(alias.kind).toBe('alias');
    expect(alias.playerId).toBe(50907);
    expect(alias.aliasWrite?.alias).toBe('merrill');
  });
});

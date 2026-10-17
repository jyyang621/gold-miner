export type GameMode = 'solo' | 'coop' | 'versus';

export const MODE_LABELS: Record<GameMode, string> = {
  solo: '单人模式', coop: '双人合作', versus: '双人对战',
};

export interface MatchScore {
  totals: [number, number];
  wins: [number, number];
  draws: number;
}

export function emptyMatch(): MatchScore {
  return { totals: [0, 0], wins: [0, 0], draws: 0 };
}

export function roundWinner(incomes: readonly [number, number]): 0 | 1 | null {
  return incomes[0] === incomes[1] ? null : incomes[0] > incomes[1] ? 0 : 1;
}

/** A completed round creates a new score; replaying a checkpoint cannot mutate it. */
export function scoreRound(previous: MatchScore, incomes: readonly [number, number]): MatchScore {
  const winner = roundWinner(incomes);
  return {
    totals: [previous.totals[0] + incomes[0], previous.totals[1] + incomes[1]],
    wins: [previous.wins[0] + (winner === 0 ? 1 : 0), previous.wins[1] + (winner === 1 ? 1 : 0)],
    draws: previous.draws + (winner === null ? 1 : 0),
  };
}

/** Reject partial/corrupt matches rather than inventing a player's missing score. */
export function readMatch(value: unknown, completedRounds: number): MatchScore | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const integer = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= max;
  if (!Array.isArray(source.totals) || source.totals.length !== 2 || !source.totals.every(n => integer(n, 1_000_000_000)) ||
      !Array.isArray(source.wins) || source.wins.length !== 2 || !source.wins.every(n => integer(n, 20)) ||
      !integer(source.draws, 20) || source.wins[0] + source.wins[1] + source.draws !== completedRounds) return null;
  return { totals: [source.totals[0], source.totals[1]], wins: [source.wins[0], source.wins[1]], draws: source.draws };
}

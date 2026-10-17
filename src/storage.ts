import { readMatch, type GameMode, type MatchScore } from './modes.ts';
import { CAMPAIGN_LEVEL_COUNT, MAX_ENDLESS_LEVEL } from './levels.ts';

export interface RunCheckpoint {
  levelIndex: number;
  wallet: number;
  bombs: number;
  strength: boolean;
  diamondBonus: boolean;
  totalEarned: number;
  seed?: number;
  match?: MatchScore;
}

export interface ShopSave {
  levelIndex: number;
  wallet: number;
  bombs: number;
  strength: boolean;
  diamondBonus: boolean;
  totalEarned: number;
  seed?: number;
  purchaseCounts: { bomb: number; strength: number; diamond: number };
}

export interface SaveData {
  version: 1;
  sound: boolean;
  bestEarned: number;
  highestCleared: number;
  checkpoint: RunCheckpoint | null;
  shop: ShopSave | null;
}

export const DEFAULT_SAVE: SaveData = {
  version: 1,
  sound: true,
  bestEarned: 0,
  highestCleared: 0,
  checkpoint: null,
  shop: null,
};

const STORAGE_KEYS: Record<GameMode, string> = {
  solo: 'gold-miner-save-v1', coop: 'gold-miner-save-coop-v1', versus: 'gold-miner-save-versus-v1',
};
const ENDLESS_STORAGE_KEYS: Record<GameMode, string> = {
  solo: 'gold-miner-save-endless-v1', coop: 'gold-miner-save-coop-endless-v1', versus: 'gold-miner-save-versus-endless-v1',
};
const MAX_MONEY = 1_000_000_000;
const MAX_ENDLESS_MONEY = 1_000_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function readRun(value: unknown, levelCount: number, maxMoney: number): RunCheckpoint | null {
  if (!isRecord(value)
    || !isInteger(value.levelIndex, 0, levelCount - 1)
    || !isInteger(value.wallet, 0, maxMoney)
    || !isInteger(value.bombs, 0, 5)
    || typeof value.strength !== 'boolean'
    || typeof value.diamondBonus !== 'boolean'
    || !isInteger(value.totalEarned, 0, maxMoney)) {
    return null;
  }

  const run: RunCheckpoint = {
    levelIndex: value.levelIndex,
    wallet: value.wallet,
    bombs: value.bombs,
    strength: value.strength,
    diamondBonus: value.diamondBonus,
    totalEarned: value.totalEarned,
  };

  // The generator uses a 32-bit seed. A damaged optional seed does not discard progress.
  if (isInteger(value.seed, 0, 0xffff_ffff)) run.seed = value.seed;
  if (value.match !== undefined) {
    const match = readMatch(value.match, run.levelIndex, levelCount, maxMoney);
    if (!match) return null;
    run.match = match;
  }
  return run;
}

function readShop(value: unknown, levelCount: number, maxMoney: number): ShopSave | null {
  const run = readRun(value, levelCount, maxMoney);
  if (!run || !isRecord(value) || !isRecord(value.purchaseCounts)) return null;
  const counts = value.purchaseCounts;
  if (!isInteger(counts.bomb, 0, 2)
    || !isInteger(counts.strength, 0, 1)
    || !isInteger(counts.diamond, 0, 1)) return null;

  return {
    levelIndex: run.levelIndex,
    wallet: run.wallet,
    bombs: run.bombs,
    strength: run.strength,
    diamondBonus: run.diamondBonus,
    totalEarned: run.totalEarned,
    ...(run.seed !== undefined ? { seed: run.seed } : {}),
    purchaseCounts: {
      bomb: counts.bomb,
      strength: counts.strength,
      diamond: counts.diamond,
    },
  };
}

function sanitize(value: unknown, mode: GameMode = 'solo', endless = false): SaveData {
  if (!isRecord(value) || value.version !== 1) return { ...DEFAULT_SAVE };
  const levelCount = endless ? MAX_ENDLESS_LEVEL : CAMPAIGN_LEVEL_COUNT;
  const maxMoney = endless ? MAX_ENDLESS_MONEY : MAX_MONEY;
  const data:SaveData = {
    version: 1,
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_SAVE.sound,
    bestEarned: isInteger(value.bestEarned, 0, maxMoney) ? value.bestEarned : 0,
    highestCleared: isInteger(value.highestCleared, 0, levelCount) ? value.highestCleared : 0,
    checkpoint: readRun(value.checkpoint, levelCount, maxMoney),
    shop: readShop(value.shop, levelCount, maxMoney),
  };
  if (mode === 'versus') {
    data.shop = null;
    const run = data.checkpoint;
    if (run && (!run.match || run.totalEarned !== run.match.totals[0] + run.match.totals[1] || run.wallet !== run.totalEarned)) data.checkpoint = null;
  }
  return data;
}

/** Returns an independent, validated snapshot even when browser storage is unavailable. */
export function loadSave(mode: GameMode = 'solo', endless = false): SaveData {
  try {
    const serialized = window.localStorage.getItem((endless ? ENDLESS_STORAGE_KEYS : STORAGE_KEYS)[mode]);
    return serialized === null ? { ...DEFAULT_SAVE } : sanitize(JSON.parse(serialized) as unknown, mode, endless);
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

/** False means progress could not be persisted; callers can continue playing in memory. */
export function saveGame(data: SaveData, mode: GameMode = 'solo', endless = false): boolean {
  try {
    if (!isRecord(data) || data.version !== 1) return false;
    window.localStorage.setItem((endless ? ENDLESS_STORAGE_KEYS : STORAGE_KEYS)[mode], JSON.stringify(sanitize(data, mode, endless)));
    return true;
  } catch {
    return false;
  }
}

/** Clears only the current adventure. The caller decides when to persist the result. */
export function clearRun(data: SaveData, mode: GameMode = 'solo', endless = false): SaveData {
  const validated = sanitize(data, mode, endless);
  validated.checkpoint = null;
  validated.shop = null;
  return validated;
}

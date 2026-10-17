export interface RunCheckpoint {
  levelIndex: number;
  wallet: number;
  bombs: number;
  strength: boolean;
  diamondBonus: boolean;
  totalEarned: number;
  seed?: number;
}

export interface ShopSave {
  levelIndex: number;
  wallet: number;
  bombs: number;
  strength: boolean;
  diamondBonus: boolean;
  totalEarned: number;
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

const STORAGE_KEY = 'gold-miner-save-v1';
const MAX_MONEY = 1_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    && value >= minimum && value <= maximum;
}

function readRun(value: unknown): RunCheckpoint | null {
  if (!isRecord(value)
    || !isInteger(value.levelIndex, 0, 19)
    || !isInteger(value.wallet, 0, MAX_MONEY)
    || !isInteger(value.bombs, 0, 5)
    || typeof value.strength !== 'boolean'
    || typeof value.diamondBonus !== 'boolean'
    || !isInteger(value.totalEarned, 0, MAX_MONEY)) {
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
  return run;
}

function readShop(value: unknown): ShopSave | null {
  const run = readRun(value);
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
    purchaseCounts: {
      bomb: counts.bomb,
      strength: counts.strength,
      diamond: counts.diamond,
    },
  };
}

function sanitize(value: unknown): SaveData {
  if (!isRecord(value) || value.version !== 1) return { ...DEFAULT_SAVE };
  return {
    version: 1,
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_SAVE.sound,
    bestEarned: isInteger(value.bestEarned, 0, MAX_MONEY) ? value.bestEarned : 0,
    highestCleared: isInteger(value.highestCleared, 0, 20) ? value.highestCleared : 0,
    checkpoint: readRun(value.checkpoint),
    shop: readShop(value.shop),
  };
}

/** Returns an independent, validated snapshot even when browser storage is unavailable. */
export function loadSave(): SaveData {
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY);
    return serialized === null ? { ...DEFAULT_SAVE } : sanitize(JSON.parse(serialized) as unknown);
  } catch {
    return { ...DEFAULT_SAVE };
  }
}

/** False means progress could not be persisted; callers can continue playing in memory. */
export function saveGame(data: SaveData): boolean {
  try {
    if (!isRecord(data) || data.version !== 1) return false;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(data)));
    return true;
  } catch {
    return false;
  }
}

/** Clears only the current adventure. The caller decides when to persist the result. */
export function clearRun(data: SaveData): SaveData {
  const validated = sanitize(data);
  validated.checkpoint = null;
  validated.shop = null;
  return validated;
}

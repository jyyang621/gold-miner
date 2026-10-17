import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import {
  DEFAULT_SAVE, clearRun, loadSave, saveGame,
  type RunCheckpoint, type SaveData, type ShopSave,
} from '../src/storage.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let memory: { value: string | null; writes: number };

function installWindow(value: unknown): void {
  Object.defineProperty(globalThis, 'window', { configurable: true, value });
}

beforeEach(() => {
  memory = { value: null, writes: 0 };
  installWindow({
    localStorage: {
      getItem: () => memory.value,
      setItem: (_key: string, value: string) => { memory.value = value; memory.writes += 1; },
    },
  });
});

after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

function checkpoint(): RunCheckpoint {
  return {
    levelIndex: 7, wallet: 1234, bombs: 3, strength: true,
    diamondBonus: false, totalEarned: 4500, seed: 123456,
  };
}

function shop(): ShopSave {
  return {
    levelIndex: 8, wallet: 900, bombs: 4, strength: false,
    diamondBonus: true, totalEarned: 4500,
    purchaseCounts: { bomb: 2, strength: 0, diamond: 1 },
  };
}

function save(overrides: Partial<SaveData> = {}): SaveData {
  return {
    version: 1, sound: false, bestEarned: 8000, highestCleared: 8,
    checkpoint: checkpoint(), shop: null, ...overrides,
  };
}

test('missing or damaged storage returns a fresh default snapshot', () => {
  assert.deepEqual(loadSave(), DEFAULT_SAVE);
  assert.notEqual(loadSave(), DEFAULT_SAVE);
  for (const raw of ['{broken JSON', 'null', '[]', '42', '{}', '{"version":2}']) {
    memory.value = raw;
    assert.deepEqual(loadSave(), DEFAULT_SAVE, raw);
  }
});

test('valid lower and upper bounds survive persistence', () => {
  for (const upper of [false, true]) {
    const edgeRun: RunCheckpoint = {
      levelIndex: upper ? 19 : 0, wallet: upper ? 1_000_000_000 : 0,
      bombs: upper ? 5 : 0, strength: upper, diamondBonus: upper,
      totalEarned: upper ? 1_000_000_000 : 0, seed: upper ? 0xffff_ffff : 0,
    };
    const data = save({
      bestEarned: upper ? 1_000_000_000 : 0,
      highestCleared: upper ? 20 : 0,
      checkpoint: edgeRun,
    });
    assert.equal(saveGame(data), true);
    assert.deepEqual(loadSave(), data);
  }
});

test('invalid checkpoint fields discard that run while preserving records', () => {
  const invalid: [string, unknown][] = [
    ['levelIndex', -1], ['levelIndex', 20], ['levelIndex', 0.5],
    ['wallet', -1], ['wallet', 1_000_000_001], ['wallet', '100'],
    ['bombs', -1], ['bombs', 6], ['bombs', 1.5],
    ['strength', 1], ['diamondBonus', 'false'],
    ['totalEarned', -1], ['totalEarned', 1_000_000_001], ['totalEarned', null],
  ];
  for (const [field, value] of invalid) {
    memory.value = JSON.stringify(save({ checkpoint: { ...checkpoint(), [field]: value } }));
    const restored = loadSave();
    assert.equal(restored.checkpoint, null, `${field}: ${String(value)}`);
    assert.equal(restored.bestEarned, 8000);
    assert.equal(restored.highestCleared, 8);
    assert.equal(restored.sound, false);
  }
});

test('invalid optional seeds are omitted without losing a valid checkpoint', () => {
  for (const seed of [-1, 0x1_0000_0000, 1.5, '123']) {
    memory.value = JSON.stringify(save({ checkpoint: { ...checkpoint(), seed } as RunCheckpoint }));
    const restored = loadSave().checkpoint;
    assert.ok(restored);
    assert.equal(restored.wallet, 1234);
    assert.equal(Object.hasOwn(restored, 'seed'), false);
  }
});

test('invalid settings and record values use safe defaults', () => {
  memory.value = JSON.stringify({
    ...save(), sound: 'off', bestEarned: 1_000_000_001, highestCleared: 21,
  });
  const restored = loadSave();
  assert.equal(restored.sound, true);
  assert.equal(restored.bestEarned, 0);
  assert.equal(restored.highestCleared, 0);
  assert.deepEqual(restored.checkpoint, checkpoint());
});

test('shop purchase counts accept their limits and reject invalid counts', () => {
  const valid = save({ checkpoint: null, shop: shop() });
  assert.equal(saveGame(valid), true);
  assert.deepEqual(loadSave(), valid);
  for (const [field, value] of [
    ['bomb', -1], ['bomb', 3], ['strength', 2], ['diamond', 2], ['diamond', 0.5],
  ] as const) {
    memory.value = JSON.stringify(save({
      checkpoint: null,
      shop: { ...shop(), purchaseCounts: { ...shop().purchaseCounts, [field]: value } },
    }));
    assert.equal(loadSave().shop, null, `${field}: ${value}`);
  }
});

test('loaded checkpoints and nested shop counts are independent copies', () => {
  const original = save({ shop: shop() });
  assert.equal(saveGame(original), true);
  original.checkpoint!.wallet = 0;
  original.shop!.purchaseCounts.bomb = 0;
  const first = loadSave();
  assert.equal(first.checkpoint!.wallet, 1234);
  assert.equal(first.shop!.purchaseCounts.bomb, 2);
  first.checkpoint!.wallet = 1;
  first.shop!.purchaseCounts.bomb = 1;
  const second = loadSave();
  assert.equal(second.checkpoint!.wallet, 1234);
  assert.equal(second.shop!.purchaseCounts.bomb, 2);
  assert.notEqual(first.checkpoint, second.checkpoint);
  assert.notEqual(first.shop!.purchaseCounts, second.shop!.purchaseCounts);
});

test('unknown persisted fields are excluded instead of merged into returned objects', () => {
  const source = JSON.parse(JSON.stringify(save()));
  Object.defineProperty(source, '__proto__', { enumerable: true, value: { polluted: true } });
  source.untrusted = true;
  source.checkpoint.untrusted = true;
  memory.value = JSON.stringify(source);
  const restored = loadSave();
  assert.equal(Object.hasOwn(restored, '__proto__'), false);
  assert.equal(Object.hasOwn(restored, 'untrusted'), false);
  assert.equal(Object.hasOwn(restored.checkpoint!, 'untrusted'), false);
  assert.equal(Object.getPrototypeOf(restored), Object.prototype);
});

test('blocked localStorage access and storage quota failures never escape', () => {
  const blockedWindow = {};
  Object.defineProperty(blockedWindow, 'localStorage', {
    get() { throw new Error('Storage access denied'); },
  });
  installWindow(blockedWindow);
  assert.deepEqual(loadSave(), DEFAULT_SAVE);
  assert.equal(saveGame(save()), false);

  installWindow({ localStorage: {
    getItem() { throw new Error('Storage read failed'); },
    setItem() { throw new Error('Quota exceeded'); },
  } });
  assert.deepEqual(loadSave(), DEFAULT_SAVE);
  assert.equal(saveGame(save()), false);
});

test('clearRun preserves settings and records without mutating or saving its input', () => {
  const original = save({ shop: shop() });
  const snapshot = structuredClone(original);
  const cleared = clearRun(original);
  assert.deepEqual(cleared, {
    version: 1, sound: false, bestEarned: 8000, highestCleared: 8,
    checkpoint: null, shop: null,
  });
  assert.deepEqual(original, snapshot);
  assert.notEqual(cleared, original);
  assert.equal(memory.writes, 0);
});

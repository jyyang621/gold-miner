import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { emptyMatch, readMatch, roundWinner, scoreRound, type GameMode } from '../src/modes.ts';
import { DEFAULT_SAVE, clearRun, loadSave, saveGame } from '../src/storage.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let items: Map<string, string>;
beforeEach(() => {
  items = new Map();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {localStorage: {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  }}});
});
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('round results distinguish a win, loss, and equal income without awarding an unpaid object', () => {
  assert.equal(roundWinner([500, 200]), 0);
  assert.equal(roundWinner([100, 600]), 1);
  assert.equal(roundWinner([0, 0]), null);
  const original = emptyMatch();
  const result = scoreRound(scoreRound(scoreRound(original, [500, 200]), [100, 600]), [0, 0]);
  assert.deepEqual(result, { totals: [600, 800], wins: [1, 1], draws: 1 });
  assert.deepEqual(original, emptyMatch());
  // Overall winner follows cumulative earnings even if round-win counts are tied.
  assert.equal(roundWinner(result.totals), 1);
});

test('all three mode saves are independent and legacy solo saves keep their original key', () => {
  const modes: GameMode[] = ['solo', 'coop', 'versus'];
  for (const [index, mode] of modes.entries()) {
    saveGame({...DEFAULT_SAVE, highestCleared: index + 1, bestEarned: 500 * (index + 1)}, mode);
  }
  assert.ok(items.has('gold-miner-save-v1'));
  assert.equal(items.size, 3);
  assert.equal(loadSave().highestCleared, 1);
  assert.equal(loadSave('coop').highestCleared, 2);
  assert.equal(loadSave('versus').highestCleared, 3);
  saveGame(clearRun(loadSave('coop')), 'coop');
  assert.equal(loadSave().bestEarned, 500);
  assert.equal(loadSave('versus').bestEarned, 1500);
});

test('versus checkpoint round scores survive refresh and are independently copied', () => {
  const match = scoreRound(emptyMatch(), [500, 200]);
  const data = {...DEFAULT_SAVE, checkpoint: {levelIndex: 1, wallet: 700, bombs: 0, strength: false, diamondBonus: false, totalEarned: 700, match}};
  assert.equal(saveGame(data, 'versus'), true);
  data.checkpoint.match.totals[0] = 0;
  const restored = loadSave('versus');
  assert.equal(restored.checkpoint?.match?.totals[0], 500);
  restored.checkpoint!.match!.wins[0] = 20;
  assert.deepEqual(loadSave('versus').checkpoint?.match?.wins, [1, 0]);
});

test('corrupted match scores or inconsistent completed-round counts discard only that run', () => {
  for (const match of [null, {totals:[500],wins:[1,0],draws:0}, {totals:[500,-1],wins:[1,0],draws:0}, {totals:[500,0],wins:[2,0],draws:0}, {totals:[500,0],wins:[1,0],draws:0.5}]) {
    assert.equal(readMatch(match, 1), null);
    items.set('gold-miner-save-versus-v1', JSON.stringify({...DEFAULT_SAVE, bestEarned:900, checkpoint:{levelIndex:1,wallet:500,bombs:0,strength:false,diamondBonus:false,totalEarned:500,match}}));
    assert.equal(loadSave('versus').checkpoint, null);
    assert.equal(loadSave('versus').bestEarned, 900);
  }
});

test('versus requires complete match scores and consistent totals, without erasing records', () => {
  for (const checkpoint of [
    {levelIndex:1,wallet:700,totalEarned:700},
    {levelIndex:1,wallet:700,totalEarned:600,match:scoreRound(emptyMatch(),[500,200])},
    {levelIndex:1,wallet:600,totalEarned:700,match:scoreRound(emptyMatch(),[500,200])},
  ]) {
    items.set('gold-miner-save-versus-v1',JSON.stringify({...DEFAULT_SAVE,bestEarned:1000,checkpoint:{bombs:0,strength:false,diamondBonus:false,...checkpoint}}));
    assert.equal(loadSave('versus').checkpoint,null);
    assert.equal(loadSave('versus').bestEarned,1000);
  }
});

test('twenty scored rounds preserve a complete cumulative result across checkpoint reloads', () => {
  let match=emptyMatch();
  for(let round=0;round<20;round++) {
    const total=match.totals[0]+match.totals[1];
    saveGame({...DEFAULT_SAVE,checkpoint:{levelIndex:round,wallet:total,bombs:0,strength:false,diamondBonus:false,totalEarned:total,match}},'versus');
    const restored=loadSave('versus').checkpoint!;
    assert.equal(restored.levelIndex,round);
    match=scoreRound(restored.match!,[500,200]);
  }
  assert.deepEqual(match,{totals:[10000,4000],wins:[20,0],draws:0});
  assert.deepEqual(readMatch(match,20),match);
  saveGame(clearRun(loadSave('versus')),'versus');
  assert.equal(loadSave('versus').checkpoint,null);
});

import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { CAMPAIGN_LEVEL_COUNT, getLevel, MAX_ENDLESS_LEVEL } from '../src/levels.ts';
import { type GameMode } from '../src/modes.ts';
import { DEFAULT_SAVE, clearRun, loadSave, saveGame, type RunCheckpoint, type SaveData, type ShopSave } from '../src/storage.ts';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let items: Map<string,string>;
beforeEach(() => {
  items = new Map();
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{
    getItem:(key:string)=>items.get(key)??null,
    setItem:(key:string,value:string)=>items.set(key,value),
  }}});
});
after(() => {
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);
  else Reflect.deleteProperty(globalThis,'window');
});

function run(index=100):RunCheckpoint {
  return {levelIndex:index,wallet:5_000_000_000,bombs:3,strength:true,diamondBonus:false,totalEarned:9_000_000_000,seed:0xffff_ffff};
}
function save(checkpoint:RunCheckpoint|null=run()):SaveData {
  return {...DEFAULT_SAVE,highestCleared:100,bestEarned:9_000_000_000,checkpoint};
}

test('campaign and endless have six independent saves without changing legacy keys', () => {
  const modes:GameMode[]=['solo','coop','versus'];
  for(const [index,mode]of modes.entries()) {
    assert.equal(saveGame({...DEFAULT_SAVE,highestCleared:index+1,bestEarned:100*(index+1)},mode),true);
    assert.equal(saveGame({...DEFAULT_SAVE,highestCleared:index+101,bestEarned:1000*(index+1)},mode,true),true);
  }
  assert.deepEqual([...items.keys()].sort(),[
    'gold-miner-save-v1','gold-miner-save-coop-v1','gold-miner-save-versus-v1',
    'gold-miner-save-endless-v1','gold-miner-save-coop-endless-v1','gold-miner-save-versus-endless-v1',
  ].sort());
  for(const [index,mode]of modes.entries()) {
    assert.equal(loadSave(mode).highestCleared,index+1);
    assert.equal(loadSave(mode,true).highestCleared,index+101);
  }
  saveGame(clearRun(loadSave('solo',true),'solo',true),'solo',true);
  assert.equal(loadSave().bestEarned,100);
  assert.equal(loadSave('solo',true).bestEarned,1000);
  assert.equal(loadSave('coop',true).bestEarned,2000);
});

test('existing twenty-level campaign saves load and can continue into the new forty levels', () => {
  const legacy={...DEFAULT_SAVE,highestCleared:20,bestEarned:12_000,checkpoint:{...run(19),wallet:3000,totalEarned:12_000}};
  items.set('gold-miner-save-v1',JSON.stringify(legacy));
  assert.deepEqual(loadSave(),legacy);
  assert.equal(saveGame({...legacy,highestCleared:CAMPAIGN_LEVEL_COUNT,checkpoint:{...legacy.checkpoint,levelIndex:CAMPAIGN_LEVEL_COUNT-1}}),true);
  assert.equal(loadSave().checkpoint?.levelIndex,39);
  assert.equal(loadSave().highestCleared,40);
  assert.deepEqual(loadSave('solo',true),DEFAULT_SAVE);
});

test('endless checkpoints preserve stage 101 and its independent large-money records', () => {
  const data=save();
  assert.equal(saveGame(data,'coop',true),true);
  assert.deepEqual(loadSave('coop',true),data);
  assert.deepEqual(loadSave('coop'),DEFAULT_SAVE);
  const cleared=clearRun(data,'coop',true);
  assert.equal(cleared.checkpoint,null);
  assert.equal(cleared.bestEarned,data.bestEarned);
  assert.equal(cleared.highestCleared,100);
  assert.ok(data.checkpoint);
});

test('endless shop reload keeps the same seed and purchase counts', () => {
  const shop:ShopSave={...run(101),purchaseCounts:{bomb:1,strength:1,diamond:0}};
  const data={...save(null),shop};
  assert.equal(saveGame(data,'solo',true),true);
  const restored=loadSave('solo',true);
  assert.deepEqual(restored.shop,shop);
  assert.deepEqual(getLevel(shop.levelIndex,true,shop.seed),getLevel(restored.shop!.levelIndex,true,restored.shop!.seed));
  shop.purchaseCounts.bomb=0;
  assert.equal(restored.shop?.purchaseCounts.bomb,1);
});

test('seedless endless progress survives and uses deterministic default seed one', () => {
  const checkpoint=run();delete checkpoint.seed;
  assert.equal(saveGame(save(checkpoint),'solo',true),true);
  const restored=loadSave('solo',true).checkpoint!;
  assert.equal(restored.levelIndex,100);
  assert.equal(Object.hasOwn(restored,'seed'),false);
  assert.deepEqual(getLevel(restored.levelIndex,true,restored.seed),getLevel(100,true,1));
  for(const seed of [-1,0x1_0000_0000,.5,'2']) {
    items.set('gold-miner-save-endless-v1',JSON.stringify(save({...run(),seed} as RunCheckpoint)));
    assert.equal(Object.hasOwn(loadSave('solo',true).checkpoint!,'seed'),false);
  }
});

test('endless maximum bounds survive while corrupted stage, money and record bounds are rejected', () => {
  const edge={...save(),highestCleared:MAX_ENDLESS_LEVEL,bestEarned:1_000_000_000_000,checkpoint:{...run(MAX_ENDLESS_LEVEL-1),wallet:1_000_000_000_000,totalEarned:1_000_000_000_000}};
  saveGame(edge,'solo',true);
  assert.deepEqual(loadSave('solo',true),edge);
  for(const [field,value]of [
    ['levelIndex',MAX_ENDLESS_LEVEL],['levelIndex',-1],['levelIndex',100.5],
    ['wallet',1_000_000_000_001],['wallet',-1],['totalEarned',1_000_000_000_001],
  ]as const) {
    items.set('gold-miner-save-endless-v1',JSON.stringify({...edge,checkpoint:{...edge.checkpoint,[field]:value}}));
    const restored=loadSave('solo',true);
    assert.equal(restored.checkpoint,null,`${field}: ${value}`);
    assert.equal(restored.highestCleared,MAX_ENDLESS_LEVEL);
    assert.equal(restored.bestEarned,1_000_000_000_000);
  }
  items.set('gold-miner-save-endless-v1',JSON.stringify({...edge,highestCleared:MAX_ENDLESS_LEVEL+1,bestEarned:1_000_000_000_001}));
  assert.equal(loadSave('solo',true).highestCleared,0);
  assert.equal(loadSave('solo',true).bestEarned,0);
});

test('endless versus preserves hundred-round totals and rejects missing or inconsistent match state', () => {
  const match={totals:[5_000_000_000,4_000_000_000]as[number,number],wins:[60,35]as[number,number],draws:5};
  const checkpoint={...run(),wallet:9_000_000_000,match};
  const data=save(checkpoint);
  assert.equal(saveGame(data,'versus',true),true);
  assert.deepEqual(loadSave('versus',true),data);
  for(const bad of [
    {...checkpoint,match:undefined},
    {...checkpoint,totalEarned:8_000_000_000},
    {...checkpoint,wallet:8_000_000_000},
    {...checkpoint,match:{...match,draws:6}},
  ]) {
    saveGame({...data,checkpoint:bad},'versus',true);
    assert.equal(loadSave('versus',true).checkpoint,null);
    assert.equal(loadSave('versus',true).bestEarned,data.bestEarned);
  }
  saveGame({...data,shop:{...run(),purchaseCounts:{bomb:0,strength:0,diamond:0}}},'versus',true);
  assert.equal(loadSave('versus',true).shop,null);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { BARREL_BLAST_RADIUS, MineEngine, PHYSICS } from '../src/engine.ts';
import { ORE_TYPES, oreValue, type LevelDefinition, type OreDefinition } from '../src/levels.ts';
import { WIDE_VIEWPORT, mineScale } from '../src/viewport.ts';

const STEP = 1 / 120;
const PHONE = { width: 720, height: 1040, portrait: true };
const ore = (id: string, x: number, y: number, kind: OreDefinition['kind'] = 'goldLarge', motion?: OreDefinition['motion']): OreDefinition =>
  ({ id, x, y, kind, radius: ORE_TYPES[kind].radius, ...(motion ? { motion } : {}) });
const fixture = (ores: OreDefinition[], duration = 60): LevelDefinition =>
  ({ id: 1, name: '动态矿场', subtitle: '', target: 500, duration, ores, palette: 'ochre' });

function until(engine: MineEngine, predicate: () => boolean, budget = 10): void {
  for (let n = 0; n < Math.ceil(budget / STEP) && !predicate() && !engine.ended; n++) engine.update(STEP);
  assert.ok(predicate(), `players=${engine.players.map(player => player.phase)}, time=${engine.timeLeft}, income=${engine.income}`);
}

function aimAt(engine: MineEngine, target: OreDefinition, player = 0): void {
  const geometry = engine.playerGeometry(player);
  engine.players[player]!.angle = Math.atan2(target.x - geometry.pivotX, target.y - geometry.pivotY);
}

test('actor prices and diamond-pig bonuses keep the pig portion unchanged', () => {
  assert.equal(oreValue(ore('pig', 640, 450, 'pig')), 30);
  assert.equal(oreValue(ore('elf', 640, 450, 'elf')), 60);
  assert.equal(oreValue(ore('barrel', 640, 450, 'barrel')), 0);
  assert.equal(oreValue(ore('diamond-pig', 640, 450, 'diamondPig')), 630);
  assert.equal(oreValue(ore('diamond-pig', 640, 450, 'diamondPig'), true), 930);
});

test('a walking pig bounces repeatedly between its centre bounds without changing depth', () => {
  const engine = new MineEngine(fixture([ore('pig', 650, 450, 'pig', { left: 640, right: 660, speed: 120 })]));
  engine.update(0.2);
  assert.ok(Math.abs(engine.ores[0]!.x - 646) < 1e-9);
  assert.equal(engine.ores[0]!.motionDirection, -1);
  assert.equal(engine.ores[0]!.y, 450);
  engine.update(0.2);
  assert.ok(Math.abs(engine.ores[0]!.x - 658) < 1e-9);
  assert.equal(engine.ores[0]!.motionDirection, 1);
  assert.equal(engine.ores[0]!.y, 450);
});

test('large dynamic updates follow the same movement as normal fixed simulation steps', () => {
  const level = fixture([ore('pig', 640, 450, 'pig', { left: 620, right: 660, speed: 85 })]);
  const large = new MineEngine(level), fixed = new MineEngine(level);
  const duration = 2.347;
  large.update(duration);
  let remaining = duration;
  while (remaining > 1e-10) { const dt = Math.min(STEP, remaining); fixed.update(dt); remaining -= dt; }
  assert.ok(Math.abs(large.ores[0]!.x - fixed.ores[0]!.x) < 1e-9);
  assert.equal(large.ores[0]!.motionDirection, fixed.ores[0]!.motionDirection);
  assert.ok(Math.abs(large.timeLeft - fixed.timeLeft) < 1e-9);
});

test('moving targets crossing between frames are caught by the hook', () => {
  const engine = new MineEngine(fixture([ore('fast-pig', 300, 450, 'pig', { left: 200, right: 1000, speed: 48000 })]));
  engine.angle = 0; engine.rope = 302; engine.launch();
  engine.update(STEP);
  assert.equal(engine.held?.id, 'fast-pig');
  assert.equal(engine.phase, 'loaded');
  assert.ok(engine.held!.x > 600 && engine.held!.x < 640);
  const position = engine.held!.x;
  engine.update(0.1);
  assert.equal(engine.held?.x, position, 'a held actor no longer walks');
});

for (const diamondBonus of [false, true]) {
  test(`a delivered diamond pig pays exactly once with bonus=${diamondBonus}`, () => {
    const engine = new MineEngine(fixture([ore('pig', 640, 450, 'diamondPig', { left: 640, right: 641, speed: 2 })]), { diamondBonus });
    engine.angle = 0; engine.launch();
    until(engine, () => engine.phase === 'loaded');
    assert.equal(engine.income, 0);
    const position = engine.held!.x;
    engine.update(0.1);
    assert.equal(engine.held?.x, position);
    until(engine, () => engine.ended);
    assert.equal(engine.income, diamondBonus ? 930 : 630);
    assert.equal(engine.players[0]!.income, engine.income);
    assert.equal(engine.drainEvents().filter(event => event.type === 'coin').length, 1);
    engine.update(20);
    assert.deepEqual(engine.drainEvents(), []);
  });
}

test('an elf clears all kinds along its swept horizontal path without earning income', () => {
  const kinds = ['goldLarge', 'rockLarge', 'diamond', 'pig', 'bag'] as const;
  const engine = new MineEngine(fixture([
    ore('elf', 200, 450, 'elf', { left: 200, right: 1000, speed: 48000 }),
    ...kinds.map((kind, index) => ore(kind, 300 + index * 65, 450, kind)),
    ore('another-elf', 900, 450, 'elf'), ore('off-path', 450, 580, 'diamond'),
  ]));
  engine.update(STEP);
  assert.ok(engine.ores.slice(1, 6).every(item => item.removed));
  assert.equal(engine.ores[6]!.removed, false, 'elves do not mine each other');
  assert.equal(engine.ores[7]!.removed, false, 'a different depth is safe');
  assert.equal(engine.income, 0);
  assert.equal(engine.drainEvents().filter(event => event.type === 'dig').length, 5);
});

test('grabbing an elf before its later same-step encounter stops that mining', () => {
  const engine = new MineEngine(fixture([
    ore('elf', 600, 450, 'elf', { left: 550, right: 1000, speed: 10000 }),
    ore('gold', 730, 450),
  ]));
  engine.angle = 0; engine.rope = 302; engine.launch();
  engine.update(STEP);
  assert.equal(engine.held?.kind, 'elf');
  assert.equal(engine.ores[1]!.removed, false);
  engine.update(3);
  assert.equal(engine.ores[1]!.removed, false);
  assert.equal(engine.income, 60);
  assert.equal(engine.drainEvents().filter(event => event.type === 'dig').length, 0);
});

test('an elf cannot remove a gold nugget already secured by a hook', () => {
  const engine = new MineEngine(fixture([
    ore('gold', 640, 450), ore('elf', 200, 450, 'elf', { left: 200, right: 1200, speed: 700 }),
  ]));
  engine.angle = 0; engine.launch();
  until(engine, () => engine.phase === 'loaded');
  assert.equal(engine.held?.id, 'gold');
  engine.update(0.4);
  assert.equal(engine.held?.id, 'gold');
  assert.equal(engine.ores[0]!.removed, false);
  until(engine, () => engine.phase === 'swing');
  assert.equal(engine.income, 500);
});

test('hooking a barrel explodes nearby unheld objects and returns an empty hook without spending inventory', () => {
  const engine = new MineEngine(fixture([
    ore('barrel', 640, 340, 'barrel'), ore('near', 680, 360), ore('safe', 1000, 580),
  ]), { bombs: 2 });
  engine.angle = 0; engine.launch();
  until(engine, () => engine.phase === 'empty');
  assert.equal(engine.held, null);
  assert.equal(engine.bombs, 2);
  assert.equal(engine.income, 0);
  assert.deepEqual(engine.ores.map(item => item.removed), [true, true, false]);
  until(engine, () => engine.phase === 'swing');
  assert.equal(engine.income, 0);
  const events = engine.drainEvents();
  assert.equal(events.filter(event => event.type === 'blast').length, 1);
  assert.equal(events.filter(event => event.type === 'coin' || event.type === 'bomb').length, 0);
});

test('nearby barrels chain exactly once each and include moving creatures in the blast', () => {
  const engine = new MineEngine(fixture([
    ore('one', 640, 340, 'barrel'), ore('two', 800, 340, 'barrel'), ore('three', 960, 340, 'barrel'),
    ore('pig', 1060, 340, 'pig', { left: 1040, right: 1120, speed: 20 }), ore('safe', 200, 600),
  ]));
  engine.angle = 0; engine.launch();
  until(engine, () => engine.phase === 'empty');
  assert.deepEqual(engine.ores.map(item => item.removed), [true, true, true, true, false]);
  assert.equal(engine.drainEvents().filter(event => event.type === 'blast').length, 3);
  engine.update(1);
  assert.equal(engine.drainEvents().filter(event => event.type === 'blast').length, 0);
  assert.equal(engine.income, 0);
});

test('barrel blast coverage and effect ellipses preserve canonical distance after rotation', () => {
  const level = fixture([
    ore('barrel', 640, 450, 'barrel'), ore('inside', 815, 450), ore('outside', 825, 450), ore('far', 400, 600),
  ]);
  for (const view of [WIDE_VIEWPORT, PHONE]) {
    const engine = new MineEngine(level); engine.setViewport(view);
    const target = engine.ores[0]!;
    aimAt(engine, target); engine.rope = Math.hypot(target.x - engine.geometry.pivotX, target.y - engine.geometry.pivotY);
    engine.launch(); engine.update(STEP);
    assert.deepEqual(engine.ores.map(item => item.removed), [true, true, false, false]);
    const blast = engine.drainEvents().find(event => event.type === 'blast')!;
    const scale = mineScale(view);
    assert.equal(blast.radiusX, BARREL_BLAST_RADIUS * scale.x);
    assert.equal(blast.radiusY, BARREL_BLAST_RADIUS * scale.y);
  }
});

test('a barrel cannot destroy the other player’s held item and its eventual payment', () => {
  const engine = new MineEngine(fixture([
    ore('gold', 640, 450), ore('barrel', 680, 450, 'barrel'), ore('safe', 1100, 600),
  ]), { playerCount: 2 });
  aimAt(engine, engine.ores[0]!, 0); engine.launch(0);
  until(engine, () => engine.players[0]!.phase === 'loaded');
  assert.equal(engine.players[0]!.held?.id, 'gold');
  aimAt(engine, engine.ores[1]!, 1); engine.launch(1);
  until(engine, () => engine.players[1]!.phase === 'empty');
  assert.equal(engine.ores[1]!.removed, true);
  assert.equal(engine.players[0]!.held?.id, 'gold');
  assert.equal(engine.ores[0]!.removed, false);
  until(engine, () => engine.players[0]!.phase === 'swing');
  assert.deepEqual(engine.players.map(player => player.income), [500, 0]);
});

test('an elf encountering a barrel triggers a blast and can be destroyed by it', () => {
  const engine = new MineEngine(fixture([
    ore('elf', 400, 450, 'elf', { left: 400, right: 1000, speed: 300 }),
    ore('barrel', 640, 450, 'barrel'), ore('gold', 700, 450),
  ]));
  engine.update(0.8);
  assert.ok(engine.ores.every(item => item.removed));
  assert.equal(engine.income, 0);
  assert.equal(engine.ended, true);
  assert.equal(engine.won, false);
  assert.equal(engine.drainEvents().filter(event => event.type === 'blast').length, 1);
});

test('a hazard-depleted duo mine waits for both empty hooks before ending', () => {
  const engine = new MineEngine(fixture([ore('barrel', 448, 350, 'barrel')]), { playerCount: 2 });
  for (const player of engine.players) { player.angle = 0; engine.launch(player.id); }
  until(engine, () => engine.ores[0]!.removed);
  assert.equal(engine.ended, false);
  until(engine, () => engine.players[0]!.phase === 'swing');
  assert.notEqual(engine.players[1]!.phase, 'swing');
  assert.equal(engine.ended, false);
  until(engine, () => engine.ended);
  assert.ok(engine.players.every(player => player.phase === 'swing'));
});

test('two hooks contesting a moving pig award it to the first arrival exactly once', () => {
  const engine = new MineEngine(fixture([ore('pig', 640, 450, 'pig', { left: 620, right: 660, speed: 5 })]), { playerCount: 2 });
  for (const player of engine.players) { aimAt(engine, engine.ores[0]!, player.id); engine.launch(player.id); }
  engine.players[1]!.rope = 90;
  engine.update(0.5);
  assert.equal(engine.players[0]!.held, null);
  assert.equal(engine.players[1]!.held?.id, 'pig');
  until(engine, () => engine.ended);
  assert.deepEqual(engine.players.map(player => player.income), [0, 30]);
  assert.equal(engine.drainEvents().filter(event => event.type === 'coin').length, 1);
});

test('rotation preserves walking positions, direction and elapsed time without returning actors to their spawn', () => {
  const level = fixture([
    ore('pig', 600, 400, 'pig', { left: 500, right: 700, speed: 190 }),
    ore('elf', 800, 580, 'elf', { left: 600, right: 900, speed: 110, direction: -1 }),
  ]);
  const engine = new MineEngine(level), reference = new MineEngine(level);
  engine.update(0.4); reference.update(0.4);
  const before = engine.ores.map(item => ({ x: item.x, y: item.y, direction: item.motionDirection }));
  const time = engine.timeLeft;
  engine.setViewport(PHONE); engine.setViewport(WIDE_VIEWPORT);
  for (const [index, item] of engine.ores.entries()) {
    assert.ok(Math.abs(item.x - before[index]!.x) < 1e-10);
    assert.ok(Math.abs(item.y - before[index]!.y) < 1e-10);
    assert.equal(item.motionDirection, before[index]!.direction);
  }
  assert.equal(engine.timeLeft, time);
  engine.update(0.7); reference.update(0.7);
  for (const [index, item] of engine.ores.entries()) {
    assert.ok(Math.abs(item.x - reference.ores[index]!.x) < 1e-9);
    assert.equal(item.motionDirection, reference.ores[index]!.motionDirection);
  }
});

test('a held creature at timeout earns nothing and all movement freezes', () => {
  const engine = new MineEngine(fixture([ore('pig', 640, 450, 'pig', { left: 640, right: 640, speed: 30 })], 0.5));
  engine.angle = 0; engine.launch();
  until(engine, () => engine.phase === 'loaded');
  engine.update(1);
  assert.equal(engine.timeLeft, 0);
  assert.equal(engine.ended, true);
  assert.equal(engine.income, 0);
  assert.equal(engine.held?.id, 'pig');
  const x = engine.ores[0]!.x, rope = engine.rope;
  engine.update(10);
  assert.equal(engine.ores[0]!.x, x);
  assert.equal(engine.rope, rope);
  assert.equal(engine.launch(), false);
  assert.equal(engine.drainEvents().filter(event => event.type === 'end').length, 1);
});

test('a creature returned exactly at the deadline pays before the result', () => {
  const engine = new MineEngine(fixture([ore('pig', 640, 450, 'diamondPig', { left: 640, right: 640, speed: 30 })]));
  engine.angle = 0; engine.launch();
  until(engine, () => engine.phase === 'loaded');
  engine.timeLeft = (engine.rope - PHYSICS.minRope) / (PHYSICS.carrySpeed / Math.sqrt(ORE_TYPES.diamondPig.weight));
  engine.update(engine.timeLeft);
  assert.equal(engine.income, 630);
  assert.equal(engine.ended, true);
  assert.equal(engine.won, true);
});

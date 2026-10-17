import assert from 'node:assert/strict';
import test from 'node:test';
import { MineEngine, PHYSICS, rayContact } from '../src/engine.ts';
import { LEVELS, ORE_TYPES, type LevelDefinition, type OreDefinition } from '../src/levels.ts';

const STEP = 1 / 120;

function ore(id: string, x: number, y: number, kind: OreDefinition['kind'] = 'goldLarge'): OreDefinition {
  return { id, kind, x, y, radius: ORE_TYPES[kind].radius };
}

function fixture(ores: OreDefinition[], target = 500, duration = 60): LevelDefinition {
  return { id: 1, name: '测试矿场', subtitle: '', target, duration, ores, palette: 'ochre' };
}

function runUntil(engine: MineEngine, predicate: () => boolean, budget = 10): void {
  for (let i = 0; i < Math.ceil(budget / STEP) && !predicate() && !engine.ended; i++) engine.update(STEP);
  assert.ok(predicate(), `condition not reached; phase=${engine.phase}, time=${engine.timeLeft}, income=${engine.income}`);
}

function launchDown(engine: MineEngine): void {
  engine.angle = 0;
  assert.equal(engine.launch(), true);
}

test('launch accepts only the idle hook and never duplicates an active launch', () => {
  const engine = new MineEngine(fixture([ore('one', 640, 450)]));
  launchDown(engine);
  assert.equal(engine.phase, 'out');
  assert.equal(engine.launch(), false);
  assert.equal(engine.launch(), false);
  runUntil(engine, () => engine.phase === 'loaded');
  assert.equal(engine.launch(), false);
  assert.equal(engine.drainEvents().filter((event) => event.type === 'launch').length, 1);
  runUntil(engine, () => engine.ended);
  assert.equal(engine.launch(), false);
});

test('ray contact uses the expanded circle and the engine grabs the nearest hit despite array order', () => {
  const far = ore('far', 640, 540);
  const near = ore('near', 640, 340, 'goldSmall');
  const miss = ore('miss', 900, 340, 'diamond');
  assert.equal(rayContact(0, far), 540 - PHYSICS.pivotY - far.radius - PHYSICS.headRadius);
  assert.equal(rayContact(0, near), 340 - PHYSICS.pivotY - near.radius - PHYSICS.headRadius);
  assert.equal(rayContact(0, miss), null);
  assert.equal(rayContact(0, ore('behind', 640, 70)), null);
  const engine = new MineEngine(fixture([far, miss, near]));
  launchDown(engine);
  runUntil(engine, () => engine.phase === 'loaded');
  assert.equal(engine.held?.id, 'near');
  assert.equal(engine.ores[0]!.held, false);
  assert.equal(engine.ores[0]!.removed, false);
});

test('grabbing never credits income; a completed return pays exactly once', () => {
  const engine = new MineEngine(fixture([ore('one', 640, 450), ore('two', 900, 500)]));
  launchDown(engine);
  runUntil(engine, () => engine.phase === 'loaded');
  assert.equal(engine.income, 0);
  assert.equal(engine.canFinish, false);
  assert.equal(engine.finish(), false);
  assert.equal(engine.held?.removed, false);
  assert.equal(engine.drainEvents().filter((event) => event.type === 'coin').length, 0);
  engine.update(STEP);
  assert.equal(engine.income, 0);
  runUntil(engine, () => engine.phase === 'swing');
  assert.equal(engine.income, 500);
  assert.equal(engine.held, null);
  assert.equal(engine.ores[0]!.removed, true);
  assert.equal(engine.drainEvents().filter((event) => event.type === 'coin').length, 1);
  for (let i = 0; i < 120; i++) engine.update(STEP);
  assert.equal(engine.income, 500);
  assert.equal(engine.drainEvents().filter((event) => event.type === 'coin').length, 0);
});

test('an item still on the rope at timeout gives no income and all actions stop', () => {
  const engine = new MineEngine(fixture([ore('one', 640, 450)], 500, 0.5), { bombs: 1 });
  launchDown(engine);
  runUntil(engine, () => engine.phase === 'loaded');
  assert.equal(engine.income, 0);
  engine.update(engine.timeLeft + 1);
  assert.equal(engine.ended, true);
  assert.equal(engine.won, false);
  assert.equal(engine.timeLeft, 0);
  assert.equal(engine.income, 0);
  assert.equal(engine.launch(), false);
  assert.equal(engine.bomb(), false);
  assert.equal(engine.finish(), false);
  engine.update(50);
  assert.equal(engine.income, 0);
  assert.equal(engine.drainEvents().filter((event) => event.type === 'end').length, 1);
  assert.deepEqual(engine.drainEvents(), []);
});

test('returning an item exactly at the deadline credits it before the final result', () => {
  const engine = new MineEngine(fixture([ore('one', 640, 450)]));
  launchDown(engine);
  runUntil(engine, () => engine.phase === 'loaded');
  const returnSpeed = PHYSICS.carrySpeed / Math.sqrt(ORE_TYPES.goldLarge.weight);
  engine.timeLeft = (engine.rope - PHYSICS.minRope) / returnSpeed;
  engine.update(engine.timeLeft);
  assert.equal(engine.income, 500);
  assert.equal(engine.timeLeft, 0);
  assert.equal(engine.ended, true);
  assert.equal(engine.won, true);
  assert.deepEqual(engine.drainEvents().filter((event) => event.type === 'coin' || event.type === 'end').map((event) => event.type), ['coin', 'end']);
});

test('bombs require a held item and stock, consume one charge, and never pay for the destroyed item', () => {
  const level = fixture([ore('one', 640, 450), ore('two', 900, 500)]);
  const emptyStock = new MineEngine(level);
  launchDown(emptyStock);
  runUntil(emptyStock, () => emptyStock.phase === 'loaded');
  assert.equal(emptyStock.canBomb, false);
  assert.equal(emptyStock.bomb(), false);
  assert.equal(emptyStock.held?.id, 'one');

  const engine = new MineEngine(level, { bombs: 1 });
  assert.equal(engine.bomb(), false);
  assert.equal(engine.bombs, 1);
  launchDown(engine);
  assert.equal(engine.bomb(), false);
  runUntil(engine, () => engine.phase === 'loaded');
  assert.equal(engine.canBomb, true);
  assert.equal(engine.bomb(), true);
  assert.equal(engine.bombs, 0);
  assert.equal(engine.held, null);
  assert.equal(engine.phase, 'empty');
  assert.equal(engine.income, 0);
  assert.equal(engine.ores[0]!.removed, true);
  assert.equal(engine.bomb(), false);
  assert.equal(engine.launch(), false);
  runUntil(engine, () => engine.phase === 'swing');
  assert.equal(engine.income, 0);
  const events = engine.drainEvents();
  assert.equal(events.filter((event) => event.type === 'bomb').length, 1);
  assert.equal(events.filter((event) => event.type === 'coin').length, 0);
  assert.equal(engine.finish(), false);
});

test('a completed target can finish early only after the hook is back, and settles once', () => {
  const engine = new MineEngine(fixture([ore('one', 640, 450), ore('two', 900, 500)]));
  assert.equal(engine.finish(), false);
  launchDown(engine);
  runUntil(engine, () => engine.phase === 'swing');
  assert.equal(engine.canFinish, true);
  const remaining = engine.timeLeft;
  assert.ok(remaining > 50);
  assert.equal(engine.finish(), true);
  assert.equal(engine.won, true);
  assert.equal(engine.ended, true);
  assert.equal(engine.canFinish, false);
  assert.equal(engine.finish(), false);
  assert.equal(engine.launch(), false);
  engine.update(100);
  assert.equal(engine.timeLeft, remaining);
  assert.equal(engine.income, 500);
  assert.equal(engine.drainEvents().filter((event) => event.type === 'end').length, 1);
});

// Witnesses from LEVEL_BALANCE.md, all with money bags valued at their 100 floor.
const ROUTES: number[][] = [
  [1], [2, 6], [3, 16, 14], [7, 3, 2], [15, 2, 3, 17],
  [3, 9, 2, 6], [4, 17, 19, 1], [16, 1, 4, 18, 2], [15, 2, 20, 3, 17],
  [16, 1, 4, 2, 20], [16, 2, 8, 4, 19], [16, 17, 19, 1, 4, 20],
  [16, 2, 8, 4, 17, 19], [16, 15, 19, 7, 4, 2, 20], [16, 2, 8, 4, 17, 19, 1],
  [16, 25, 15, 17, 7, 3, 4, 2], [15, 25, 18, 8, 3, 17, 1, 11],
  [16, 26, 15, 7, 17, 3, 4, 2, 10], [26, 16, 4, 1, 7, 13, 15, 10, 17],
  [16, 26, 15, 7, 17, 3, 4, 18, 2, 10],
];

function waitForCenterAim(engine: MineEngine, target: OreDefinition): void {
  const targetAngle = Math.atan2(target.x - PHYSICS.pivotX, target.y - PHYSICS.pivotY);
  for (let i = 0; i < 1200 && !engine.ended; i++) {
    const forwardDifference = (targetAngle - engine.angle) * engine.direction;
    if (forwardDifference >= 0 && forwardDifference <= PHYSICS.swingSpeed * STEP) {
      engine.update(forwardDifference / PHYSICS.swingSpeed);
      assert.ok(Math.abs(engine.angle - targetAngle) < 1e-9);
      return;
    }
    engine.update(STEP);
  }
  assert.fail(`could not aim at ${target.id}`);
}

test('the real engine completes every one of the 20 levels without any upgrade or money-bag luck', async (context) => {
  const results: string[] = [];
  for (const [index, source] of LEVELS.slice(0, 20).entries()) {
    await context.test(`level ${source.id}: ${source.name}`, () => {
      const level = { ...source, ores: source.ores.map((item) => item.kind === 'bag' ? { ...item, bagValue: 100 } : { ...item }) };
      const engine = new MineEngine(level);
      assert.equal(engine.strength, false);
      assert.equal(engine.diamondBonus, false);
      assert.equal(engine.bombs, 0);
      for (const slot of ROUTES[index]!) {
        const target = engine.ores[slot - 1]!;
        assert.ok(!target.removed);
        assert.equal(engine.phase, 'swing');
        engine.update(0.25);
        waitForCenterAim(engine, target);
        assert.equal(engine.launch(), true);
        runUntil(engine, () => engine.phase === 'loaded');
        assert.equal(engine.held?.id, target.id, `level ${source.id} shot intended slot ${slot}`);
        runUntil(engine, () => engine.phase === 'swing');
      }
      assert.ok(engine.income >= level.target, `level ${source.id} income=${engine.income}`);
      assert.ok(engine.timeLeft > 0);
      assert.equal(engine.finish(), true);
      assert.equal(engine.ended, true);
      assert.equal(engine.won, true);
      results.push(`${source.id}: ${(level.duration - engine.timeLeft).toFixed(2)}s / ${engine.income}`);
    });
  }
  console.log('Real-engine replay results:\n' + results.join('\n'));
});

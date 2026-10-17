import assert from 'node:assert/strict';
import test from 'node:test';
import { MineEngine, PHYSICS, rayContact } from '../src/engine.ts';
import { LEVELS, ORE_TYPES, type LevelDefinition, type OreDefinition } from '../src/levels.ts';
import { WIDE_VIEWPORT } from '../src/viewport.ts';

const STEP = 1 / 120;
const ore = (id: string, x: number, y: number, kind: OreDefinition['kind'] = 'goldLarge'): OreDefinition =>
  ({ id, x, y, kind, radius: ORE_TYPES[kind].radius });
const fixture = (ores: OreDefinition[], duration = 60): LevelDefinition =>
  ({ ...LEVELS[0]!, target: 500, duration, ores });

function until(engine: MineEngine, predicate: () => boolean, budget = 15): void {
  for (let i = 0; i < budget / STEP && !engine.ended && !predicate(); i++) engine.update(STEP);
  assert.ok(predicate(), `players=${engine.players.map(player => player.phase)}, time=${engine.timeLeft}`);
}

function aim(engine: MineEngine, player: number, target: OreDefinition): void {
  const geometry = engine.playerGeometry(player);
  engine.players[player]!.angle = Math.atan2(target.x - geometry.pivotX, target.y - geometry.pivotY);
}

function independentMine(options: { bombs?: number; bombStocks?: readonly [number, number] } = {}): MineEngine {
  const engine = new MineEngine(fixture([ore('left', 448, 430), ore('right', 832, 430)]), { playerCount: 2, ...options });
  for (const player of engine.players) {
    player.angle = 0;
    assert.equal(engine.launch(player.id), true);
  }
  return engine;
}

test('the default remains one player, with original properties aliased to player one', () => {
  const engine = new MineEngine(LEVELS[0]!);
  assert.equal(engine.players.length, 1);
  assert.equal(engine.playerCount, 1);
  engine.angle = 0.25;
  engine.players[0]!.rope = 80;
  assert.equal(engine.players[0]!.angle, 0.25);
  assert.equal(engine.rope, 80);
  assert.deepEqual(engine.head, engine.playerHead(0));
  assert.deepEqual(engine.geometry, engine.playerGeometry(0));
  assert.equal(engine.launch(1), false);
  assert.equal(engine.bomb(1), false);
  assert.equal(engine.canBombFor(1), false);
});

test('both players launch and return independently, each delivery pays only its owner once', () => {
  const engine = independentMine();
  assert.equal(engine.players.length, 2);
  assert.equal(engine.launch(0), false);
  assert.equal(engine.launch(1), false);
  assert.equal(engine.launch(9), false);
  until(engine, () => engine.players.every(player => player.phase === 'loaded'));
  assert.equal(engine.income, 0);
  assert.notEqual(engine.players[0]!.held, engine.players[1]!.held);
  assert.deepEqual(engine.players.map(player => player.income), [0, 0]);
  until(engine, () => engine.ended);
  assert.equal(engine.income, 1000);
  assert.deepEqual(engine.players.map(player => player.income), [500, 500]);
  const coins = engine.drainEvents().filter(event => event.type === 'coin');
  assert.deepEqual(coins.map(event => event.player).sort(), [0, 1]);
  assert.equal(coins.reduce((sum, event) => sum + event.value!, 0), engine.income);
  engine.update(10);
  assert.equal(engine.drainEvents().length, 0);
  assert.deepEqual(engine.players.map(player => player.income), [500, 500]);
});

test('the hook arriving first claims a contested ore even when it is player two', () => {
  const engine = new MineEngine(fixture([ore('contested', 640, 450)]), { playerCount: 2 });
  for (const player of engine.players) { aim(engine, player.id, engine.ores[0]!); engine.launch(player.id); }
  // Both contacts fall in this one frame; P2 has travelled farther already.
  engine.players[1]!.rope = 90;
  engine.update(0.5);
  assert.equal(engine.players[0]!.held, null);
  assert.equal(engine.players[1]!.held?.id, 'contested');
  assert.equal(engine.drainEvents().filter(event => event.type === 'grab').length, 1);
  until(engine, () => engine.ended);
  assert.deepEqual(engine.players.map(player => player.income), [0, 500]);
  assert.equal(engine.income, 500);
});

test('exact simultaneous contact has a stable tie break and never duplicates the mineral', () => {
  const engine = new MineEngine(fixture([ore('contested', 640, 450)]), { playerCount: 2 });
  for (const player of engine.players) { aim(engine, player.id, engine.ores[0]!); engine.launch(player.id); }
  assert.equal(rayContact(engine.players[0]!.angle, engine.ores[0]!, engine.playerGeometry(0)),
    rayContact(engine.players[1]!.angle, engine.ores[0]!, engine.playerGeometry(1)));
  engine.update(0.5);
  assert.equal(engine.players[0]!.held?.id, 'contested');
  assert.equal(engine.players[1]!.held, null);
  until(engine, () => engine.ended);
  assert.deepEqual(engine.players.map(player => player.income), [500, 0]);
  assert.equal(engine.income, 500);
  assert.equal(engine.drainEvents().filter(event => event.type === 'coin').length, 1);
});

test('a mineral claimed by the other hook does not block a later free mineral', () => {
  const near = ore('near', 640, 350, 'goldSmall');
  const angle = Math.atan2(640 - 448, 350 - PHYSICS.pivotY);
  const far = ore('far', 448 + Math.sin(angle) * 590, PHYSICS.pivotY + Math.cos(angle) * 590);
  const engine = new MineEngine(fixture([near, far]), { playerCount: 2 });
  for (const player of engine.players) { aim(engine, player.id, near); engine.launch(player.id); }
  engine.players[1]!.rope = 90;
  engine.update(0.8);
  assert.equal(engine.players[1]!.held?.id, 'near');
  assert.equal(engine.players[0]!.held?.id, 'far');
  assert.equal(engine.drainEvents().filter(event => event.type === 'grab').length, 2);
});

test('cooperation shares bomb stock while a bomb destroys only the chosen held item', () => {
  const engine = independentMine({ bombs: 1 });
  until(engine, () => engine.players.every(player => player.phase === 'loaded'));
  assert.equal(engine.canBombFor(0), true);
  assert.equal(engine.canBombFor(1), true);
  assert.equal(engine.bomb(1), true);
  assert.equal(engine.bombs, 0);
  assert.equal(engine.bombStocks, null);
  assert.equal(engine.players[1]!.phase, 'empty');
  assert.equal(engine.players[1]!.held, null);
  assert.equal(engine.ores[1]!.removed, true);
  assert.equal(engine.players[0]!.held?.id, 'left');
  assert.equal(engine.ores[0]!.removed, false);
  assert.equal(engine.canBombFor(0), false);
  assert.equal(engine.bomb(0), false);
  until(engine, () => engine.ended);
  assert.deepEqual(engine.players.map(player => player.income), [500, 0]);
  assert.equal(engine.income, 500);
});

test('versus bomb stocks cannot be spent by the other player', () => {
  const stocks = [1, 1] as const;
  const engine = independentMine({ bombStocks: stocks });
  assert.equal(engine.bombs, 2);
  until(engine, () => engine.players.every(player => player.phase === 'loaded'));
  assert.equal(engine.bomb(0), true);
  assert.deepEqual(engine.bombStocks, [0, 1]);
  assert.deepEqual(stocks, [1, 1], 'engine owns its stock copy');
  assert.equal(engine.bombs, 1);
  assert.equal(engine.canBombFor(0), false);
  assert.equal(engine.canBombFor(1), true);
  assert.equal(engine.bomb(0), false);
  assert.equal(engine.bomb(1), true);
  assert.deepEqual(engine.bombStocks, [0, 0]);
  assert.equal(engine.bombs, 0);
  until(engine, () => engine.ended);
  assert.equal(engine.income, 0);
});

test('two active hooks share one clock and finishing waits for both hooks', () => {
  const engine = new MineEngine(fixture([ore('spare', 640, 500)]), { playerCount: 2 });
  engine.income = 500;
  engine.players[1]!.angle = 0;
  engine.launch(1);
  assert.equal(engine.phase, 'swing');
  assert.equal(engine.canFinish, false);
  assert.equal(engine.finish(), false);
  engine.update(0.25);
  assert.equal(engine.timeLeft, 59.75);
  until(engine, () => engine.players[1]!.phase === 'swing');
  assert.equal(engine.canFinish, true);
  assert.equal(engine.finish(), true);
  assert.equal(engine.launch(0), false);
  assert.equal(engine.launch(1), false);
  assert.equal(engine.bomb(1), false);
});

test('timeout does not pay either undelivered item and emits a single result', () => {
  const engine = independentMine();
  until(engine, () => engine.players.every(player => player.phase === 'loaded'));
  engine.timeLeft = 0.01;
  engine.update(1);
  assert.equal(engine.timeLeft, 0);
  assert.equal(engine.ended, true);
  assert.equal(engine.income, 0);
  assert.deepEqual(engine.players.map(player => player.income), [0, 0]);
  assert.ok(engine.players.every(player => player.held !== null));
  engine.update(1);
  assert.equal(engine.drainEvents().filter(event => event.type === 'end').length, 1);
});

test('both returns exactly at the deadline count toward the shared result', () => {
  const engine = independentMine();
  until(engine, () => engine.players.every(player => player.phase === 'loaded'));
  engine.timeLeft = (engine.rope - PHYSICS.minRope) / (PHYSICS.carrySpeed / Math.sqrt(ORE_TYPES.goldLarge.weight));
  engine.update(engine.timeLeft);
  assert.equal(engine.ended, true);
  assert.equal(engine.won, true);
  assert.equal(engine.income, 1000);
  assert.deepEqual(engine.players.map(player => player.income), [500, 500]);
  assert.deepEqual(engine.drainEvents().filter(event => event.type === 'coin' || event.type === 'end').map(event => event.type), ['coin', 'coin', 'end']);
});

test('rotation preserves both active shots, ownership, scores and the shared clock', () => {
  const engine = independentMine({ bombStocks: [1, 1] });
  until(engine, () => engine.players.every(player => player.phase === 'loaded'));
  engine.players[0]!.income = 100;
  engine.players[1]!.income = 250;
  engine.income = 350;
  const before = engine.players.map(player => ({ ...player }));
  const beforeHeads = engine.players.map(player => engine.playerHead(player.id));
  const time = engine.timeLeft;
  engine.setViewport({ width: 720, height: 1040, portrait: true });
  assert.equal(engine.playerGeometry(0).pivotX, 720 * 0.32);
  assert.equal(engine.playerGeometry(1).pivotX, 720 * 0.68);
  assert.ok(engine.players.every(player => player.phase === 'loaded'));
  assert.deepEqual(engine.players.map(player => player.held), before.map(player => player.held));
  assert.deepEqual(engine.players.map(player => player.income), [100, 250]);
  assert.deepEqual(engine.bombStocks, [1, 1]);
  assert.equal(engine.income, 350);
  assert.equal(engine.timeLeft, time);
  engine.setViewport(WIDE_VIEWPORT);
  for (const [index, player] of engine.players.entries()) {
    assert.ok(Math.abs(player.rope - before[index]!.rope) < 1e-10);
    assert.ok(Math.abs(player.angle - before[index]!.angle) < 1e-10);
    const head = engine.playerHead(index);
    assert.ok(Math.abs(head.x - beforeHeads[index]!.x) < 1e-10);
    assert.ok(Math.abs(head.y - beforeHeads[index]!.y) < 1e-10);
  }
});

test('rotation keeps both outgoing hooks and their pending effects at their own winches', () => {
  const engine = new MineEngine(LEVELS[2]!, { playerCount: 2 });
  for (const player of engine.players) {
    player.angle = player.id === 0 ? -0.45 : 0.6;
    engine.launch(player.id);
    player.rope = 180 + player.id * 70;
  }
  const before = engine.players.map(player => ({ ...player }));
  engine.setViewport({ width: 720, height: 1040, portrait: true });
  const effects = engine.drainEvents();
  assert.equal(effects.length, 2);
  for (const event of effects) {
    const geometry = engine.playerGeometry(event.player!);
    assert.equal(event.type, 'launch');
    assert.ok(Math.abs(event.x - geometry.pivotX) < 30, 'launch effect stays beside its own miner');
  }
  assert.ok(engine.players.every(player => player.phase === 'out'));
  engine.setViewport(WIDE_VIEWPORT);
  for (const player of engine.players) {
    assert.equal(player.phase, before[player.id]!.phase);
    assert.equal(player.direction, before[player.id]!.direction);
    assert.ok(Math.abs(player.rope - before[player.id]!.rope) < 1e-10);
    assert.ok(Math.abs(player.angle - before[player.id]!.angle) < 1e-10);
  }
  assert.equal(engine.timeLeft, engine.level.duration);
});

test('every mineral in all 20 mines can be reached by at least one player in both orientations', () => {
  for (const view of [WIDE_VIEWPORT, { width: 720, height: 820, portrait: true }, { width: 720, height: 1200, portrait: true }]) {
    for (const level of LEVELS) {
      const engine = new MineEngine(level, { playerCount: 2 });
      engine.setViewport(view);
      for (const target of engine.ores) {
        const reachable = engine.players.some(player => {
          const geometry = engine.playerGeometry(player.id);
          const angle = Math.atan2(target.x - geometry.pivotX, target.y - geometry.pivotY);
          const distance = rayContact(angle, target, geometry);
          return Math.abs(angle) <= geometry.maxAngle && distance !== null && distance <= geometry.maxRope;
        });
        assert.ok(reachable, `${target.id} reachable in ${view.width}x${view.height}`);
      }
    }
  }
});

test('the entire mine only ends after the second empty hook is also home', () => {
  const engine = new MineEngine(fixture([ore('left', 448, 430)]), { playerCount: 2 });
  engine.angle = 0;
  engine.launch(0);
  until(engine, () => engine.phase === 'loaded' && engine.rope < 120);
  engine.players[1]!.angle = 0;
  engine.launch(1);
  until(engine, () => engine.ores[0]!.removed);
  assert.equal(engine.players[0]!.phase, 'swing');
  assert.notEqual(engine.players[1]!.phase, 'swing');
  assert.equal(engine.ended, false);
  until(engine, () => engine.ended);
  assert.ok(engine.players.every(player => player.phase === 'swing'));
});

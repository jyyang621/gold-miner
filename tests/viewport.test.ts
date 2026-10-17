import assert from 'node:assert/strict';
import test from 'node:test';
import { MineEngine, PHYSICS, rayContact } from '../src/engine.ts';
import { LEVELS, ORE_TYPES, oreValue, type LevelDefinition } from '../src/levels.ts';
import { WIDE_VIEWPORT, mineGeometry, type MineViewport } from '../src/viewport.ts';

const STEP = 1 / 120;
const PHONE: MineViewport = { width: 720, height: 1040, portrait: true };

test('the wide geometry retains every original physical limit', () => {
  const geometry = mineGeometry(WIDE_VIEWPORT);
  assert.equal(geometry.pivotX, PHYSICS.pivotX);
  assert.equal(geometry.pivotY, PHYSICS.pivotY);
  assert.equal(geometry.minRope, PHYSICS.minRope);
  assert.equal(geometry.maxRope, PHYSICS.maxRope);
  assert.equal(geometry.maxAngle, PHYSICS.maxAngle);
  assert.equal(geometry.speedScale, 1);
  assert.deepEqual(geometry.bounds, { left: 28, right: 1252, bottom: 690 });
  const engine = new MineEngine(LEVELS[0]!);
  engine.setViewport(WIDE_VIEWPORT);
  assert.deepEqual(engine.ores.map(({ removed, held, ...ore }) => ore), LEVELS[0]!.ores);
});

test('changing orientation preserves a held item, income, time, upgrades, and shot state', () => {
  const engine = new MineEngine(LEVELS[2]!, { bombs: 2, strength: true, diamondBonus: true });
  const target = engine.ores[0]!;
  engine.angle = Math.atan2(target.x - PHYSICS.pivotX, target.y - PHYSICS.pivotY);
  engine.launch();
  while (engine.phase === 'out') engine.update(STEP);
  assert.equal(engine.phase, 'loaded');
  const held = engine.held;
  const time = engine.timeLeft;
  const angle = engine.angle, rope = engine.rope;
  engine.income = 600;
  engine.setViewport(PHONE);
  assert.equal(engine.phase, 'loaded');
  assert.equal(engine.held, held);
  assert.equal(engine.held?.held, true);
  assert.equal(engine.timeLeft, time);
  assert.equal(engine.income, 600);
  assert.equal(engine.bombs, 2);
  assert.equal(engine.strength, true);
  assert.equal(engine.diamondBonus, true);
  engine.setViewport(WIDE_VIEWPORT);
  assert.ok(Math.abs(engine.angle - angle) < 1e-10);
  assert.ok(Math.abs(engine.rope - rope) < 1e-10);
  assert.deepEqual(engine.ores.map(({ removed, held, ...ore }) => ore), LEVELS[2]!.ores);
  while (engine.phase === 'loaded') engine.update(STEP);
  assert.equal(engine.income, 600 + oreValue(held!, true));
});

test('rotation during an outgoing shot catches a circle that now surrounds the hook', () => {
  const level: LevelDefinition = { ...LEVELS[0]!, ores: [
    { id: 'resized-circle', kind: 'goldLarge', x: 850, y: 450, radius: 38 },
  ] };
  const engine = new MineEngine(level);
  engine.angle = Math.atan2(210, 302);
  engine.rope = Math.hypot(210, 302) - 40;
  engine.phase = 'out';
  engine.setViewport(PHONE);
  engine.update(STEP);
  assert.equal(engine.phase, 'loaded');
  assert.equal(engine.held?.id, 'resized-circle');
});

test('all campaign portrait mines keep full-size minerals visible and within the hook reach', () => {
  for (const height of [820, 1040, 1200]) {
    for (const level of LEVELS) {
      const engine = new MineEngine(level);
      engine.setViewport({ width: 720, height, portrait: true });
      const geometry = engine.geometry;
      for (const [index, ore] of engine.ores.entries()) {
        assert.equal(ore.radius, level.ores[index]!.radius);
        assert.ok(ore.x - ore.radius >= 0 && ore.x + ore.radius <= 720, `${ore.id} horizontally visible`);
        assert.ok(ore.y - ore.radius > geometry.pivotY && ore.y + ore.radius < height, `${ore.id} vertically visible`);
        const angle = Math.atan2(ore.x - geometry.pivotX, ore.y - geometry.pivotY);
        assert.ok(Math.abs(angle) <= geometry.maxAngle, `${ore.id} within swing`);
        assert.ok(rayContact(angle, ore, geometry)! < geometry.maxRope, `${ore.id} within rope reach`);
      }
    }
  }
});

interface RouteState { mask: number; angle: number; direction: number; time: number; income: number; route: number[] }

/** Search real visible centre shots, including swing waits and all return weights. */
function findRoute(engine: MineEngine): number[] {
  const geometry = engine.geometry;
  const aimAngles = engine.ores.map(ore => Math.atan2(ore.x - geometry.pivotX, ore.y - geometry.pivotY));
  const contacts = aimAngles.map(angle => engine.ores.map(ore => rayContact(angle, ore, geometry)));
  let frontier: RouteState[] = [{ mask: 0, angle: engine.angle, direction: engine.direction, time: 0, income: 0, route: [] }];
  for (let depth = 0; depth < engine.ores.length; depth++) {
    const next = new Map<string, RouteState>();
    for (const state of frontier) {
      for (let index = 0; index < engine.ores.length; index++) {
        if (state.mask & (1 << index)) continue;
        const target = engine.ores[index]!;
        const angle = aimAngles[index]!;
        const distance = contacts[index]![index]!;
        const blocked = contacts[index]!.some((hit, other) => other !== index && !(state.mask & (1 << other)) && hit !== null && hit < distance);
        if (blocked) continue;
        // Add a small reaction delay before aiming at every shot.
        let current = state.angle + state.direction * PHYSICS.swingSpeed * 0.25;
        let direction = state.direction;
        if (current > geometry.maxAngle) { current = 2 * geometry.maxAngle - current; direction = -1; }
        if (current < -geometry.maxAngle) { current = -2 * geometry.maxAngle - current; direction = 1; }
        const forwards = (angle - current) * direction >= 0;
        const wait = forwards ? Math.abs(angle - current) / PHYSICS.swingSpeed :
          (Math.abs(direction * geometry.maxAngle - current) + Math.abs(direction * geometry.maxAngle - angle)) / PHYSICS.swingSpeed;
        if (!forwards) direction *= -1;
        const travel = (distance - geometry.minRope) / geometry.speedScale *
          (1 / PHYSICS.launchSpeed + Math.sqrt(ORE_TYPES[target.kind].weight) / PHYSICS.carrySpeed);
        const time = state.time + 0.25 + wait + travel + STEP * 2;
        if (time >= engine.level.duration) continue;
        const candidate: RouteState = { mask: state.mask | (1 << index), angle, direction, time,
          income: state.income + oreValue(target), route: [...state.route, index] };
        if (candidate.income >= engine.level.target) return candidate.route;
        const key = `${candidate.mask}:${index}:${direction}`;
        if (!next.has(key) || next.get(key)!.time > candidate.time) next.set(key, candidate);
      }
    }
    frontier = [...next.values()].sort((a, b) => (b.income / Math.max(1, b.time)) - (a.income / Math.max(1, a.time))).slice(0, 600);
  }
  assert.fail(`no portrait route for level ${engine.level.id}`);
}

function aimAndCollect(engine: MineEngine, index: number): void {
  engine.update(0.25);
  const geometry = engine.geometry;
  const target = engine.ores[index]!;
  const angle = Math.atan2(target.x - geometry.pivotX, target.y - geometry.pivotY);
  for (let step = 0; step < 1200 && !engine.ended; step++) {
    const forward = (angle - engine.angle) * engine.direction;
    if (forward >= 0 && forward <= PHYSICS.swingSpeed * STEP) {
      engine.update(forward / PHYSICS.swingSpeed);
      break;
    }
    engine.update(STEP);
  }
  assert.ok(Math.abs(engine.angle - angle) < 1e-8);
  assert.equal(engine.launch(), true);
  while (engine.phase === 'out' && !engine.ended) engine.update(STEP);
  assert.equal(engine.held?.id, target.id);
  while (engine.phase === 'loaded' && !engine.ended) engine.update(STEP);
}

test('all 20 portrait levels can be completed without upgrades, bombs, or money-bag luck', async context => {
  for (const height of [820, 1200]) {
    for (const source of LEVELS.slice(0, 20)) {
      await context.test(`${height}px mine, level ${source.id}`, () => {
        const level = { ...source, ores: source.ores.map(ore => ({ ...ore, ...(ore.kind === 'bag' ? { bagValue: 100 } : {}) })) };
        const engine = new MineEngine(level);
        engine.setViewport({ width: 720, height, portrait: true });
        const route = findRoute(engine);
        for (const index of route) aimAndCollect(engine, index);
        assert.ok(engine.income >= level.target, `income=${engine.income}, target=${level.target}`);
        assert.ok(engine.timeLeft > 0);
        assert.equal(engine.finish(), true);
        assert.equal(engine.won, true);
      });
    }
  }
});

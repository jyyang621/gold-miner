import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  CAMPAIGN_LEVEL_COUNT, LEVELS, MAX_ENDLESS_LEVEL, ORE_TYPES, generateEndlessLevel, getLevel, oreValue,
  type LevelDefinition, type OreDefinition, type OreKind,
} from '../src/levels.ts';
import { mineGeometry, mineScale } from '../src/viewport.ts';
import { MineEngine, PHYSICS, rayContact } from '../src/engine.ts';

const NEW_KINDS: OreKind[] = ['barrel', 'pig', 'diamondPig', 'elf'];

test('campaign contains 40 consecutive levels and preserves the original 20 definitions exactly', () => {
  assert.equal(CAMPAIGN_LEVEL_COUNT, 40);
  assert.equal(LEVELS.length, CAMPAIGN_LEVEL_COUNT);
  assert.deepEqual(LEVELS.map(level => level.id), Array.from({ length: 40 }, (_, index) => index + 1));
  assert.equal(createHash('sha256').update(JSON.stringify(LEVELS.slice(0, 20))).digest('hex'),
    '865286792963ff951e6275ea1e6f52433a051745cddef1cbe8c6746d67b22b6d');
  for (let index = 0; index < LEVELS.length; index++) assert.equal(getLevel(index), LEVELS[index]);
});

test('the new chapter introduces the four mechanics on levels 21 through 24', () => {
  NEW_KINDS.forEach((kind, offset) => {
    assert.ok(LEVELS.slice(0, 20 + offset).every(level => level.ores.every(ore => ore.kind !== kind)), kind);
    assert.ok(LEVELS[20 + offset]!.ores.some(ore => ore.kind === kind), kind);
  });
  assert.ok(LEVELS[20]!.target < LEVELS[19]!.target, 'the new mechanics have a learning stage');
  for (const level of LEVELS.slice(20)) {
    assert.equal(level.duration, 60);
    assert.ok(level.target >= 1600 && level.target <= 5000);
    assert.ok(level.ores.length <= 25);
  }
});

test('pig and elf prices are explicit and a diamond pig includes both components of its value', () => {
  const ore = (kind: OreKind): OreDefinition => ({ id: kind, kind, x: 640, y: 525, radius: ORE_TYPES[kind].radius });
  assert.equal(oreValue(ore('pig')), 30);
  assert.equal(oreValue(ore('elf')), 60);
  assert.ok(oreValue(ore('elf')) > oreValue(ore('pig')));
  assert.equal(oreValue(ore('diamondPig')), oreValue(ore('pig')) + oreValue(ore('diamond')));
  assert.equal(oreValue(ore('diamondPig'), true), oreValue(ore('pig'), true) + oreValue(ore('diamond'), true));
  assert.equal(oreValue(ore('diamondPig'), true), 930);
  assert.equal(oreValue(ore('barrel')), 0);
});

function verifyPlayableLayout(level: LevelDefinition): void {
  const safe = level.ores.filter(ore => ore.y < 500);
  assert.equal(safe.length, 16);
  assert.ok(safe.reduce((sum, ore) => sum + oreValue(ore), 0) >= level.target * 1.6,
    `level ${level.id} retains ample safe value after every lower prize is lost`);
  const barrels = level.ores.filter(ore => ore.kind === 'barrel');
  const elves = level.ores.filter(ore => ore.kind === 'elf');
  for (const ore of safe) {
    for (const barrel of barrels) {
      assert.ok(Math.hypot(ore.x - barrel.x, ore.y - barrel.y) > 140 + ore.radius + 10,
        `${ore.id} is outside the blast with a margin`);
    }
    for (const elf of elves) assert.ok(Math.abs(ore.y - elf.y) > ore.radius + elf.radius + 10);
  }

  for (const height of [740, 1040, 1400]) {
    const viewport = { width: 720, height, portrait: true };
    const geometry = mineGeometry(viewport);
    const scale = mineScale(viewport);
    const transformed = level.ores.map(ore => ({ ...ore,
      x: 360 + (ore.x - 640) * scale.x, y: 148 + (ore.y - 148) * scale.y }));
    transformed.forEach((ore, index) => {
      assert.ok(ore.x - ore.radius >= 28 && ore.x + ore.radius <= 692, `${ore.id} x bounds`);
      assert.ok(ore.y - ore.radius > 213 && ore.y + ore.radius < geometry.bounds.bottom, `${ore.id} y bounds`);
      assert.ok(Math.abs(Math.atan2(ore.x - 360, ore.y - 148)) <= geometry.maxAngle, `${ore.id} swing range`);
      assert.ok(Math.hypot(ore.x - 360, ore.y - 148) - ore.radius - 8 < geometry.maxRope, `${ore.id} rope range`);
      if (ore.motion) {
        const left = 360 + (ore.motion.left - 640) * scale.x;
        const right = 360 + (ore.motion.right - 640) * scale.x;
        assert.ok(left - ore.radius >= 28 && right + ore.radius <= 692, `${ore.id} entire travel path visible`);
        assert.ok(ore.motion.left <= level.ores[index]!.x && level.ores[index]!.x <= ore.motion.right);
        assert.ok(ore.motion.speed > 0 && ore.motion.speed <= 100);
      }
      for (const other of transformed.slice(index + 1)) {
        assert.ok(Math.hypot(ore.x - other.x, ore.y - other.y) >= ore.radius + other.radius + 6,
          `${ore.id} and ${other.id} initially separated in ${height}px portrait mine`);
      }
    });
  }
}

test('new campaign layouts keep hazards apart from the main prizes and fit portrait screens', () => {
  for (const level of LEVELS.slice(20)) verifyPlayableLayout(level);
});

test('endless mines are deterministic for the same seed and round, and vary with either input', () => {
  const first = generateEndlessLevel(0, 123456789);
  assert.deepEqual(generateEndlessLevel(0, 123456789), first);
  assert.deepEqual(getLevel(0, true, 123456789), first);
  assert.notDeepEqual(generateEndlessLevel(0, 123456790).ores, first.ores);
  assert.notDeepEqual(generateEndlessLevel(1, 123456789).ores, first.ores);
  assert.equal(first.target, 1000);
  for (const kind of NEW_KINDS) assert.ok(first.ores.some(ore => ore.kind === kind), `first mine includes ${kind}`);
});

test('endless round 1000 and the maximum round remain bounded, visible, and rich enough to complete', () => {
  for (const seed of [0, 1, 987654321, 0xffff_ffff]) {
    let previousTarget = 0;
    for (const index of [0, 1, 2, 9, 19, 99, 999, MAX_ENDLESS_LEVEL - 1]) {
      const level = generateEndlessLevel(index, seed);
      assert.equal(level.id, index + 1);
      assert.equal(level.duration, 60);
      assert.ok(level.ores.length >= 23 && level.ores.length <= 25);
      assert.ok(level.target >= previousTarget && level.target <= 4800);
      previousTarget = level.target;
      assert.equal(new Set(level.ores.map(ore => ore.id)).size, level.ores.length);
      verifyPlayableLayout(level);
    }
  }
});

test('out-of-range rounds reject immediately rather than creating an unbounded mine', () => {
  for (const index of [-1, 0.5, NaN, Infinity, MAX_ENDLESS_LEVEL]) {
    assert.throws(() => generateEndlessLevel(index, 1), RangeError);
  }
  for (const index of [-1, 0.5, NaN, Infinity, CAMPAIGN_LEVEL_COUNT]) assert.throws(() => getLevel(index), RangeError);
  assert.throws(() => generateEndlessLevel(0, NaN), RangeError);
});

interface SafeRoute { mask: number; angle: number; direction: number; time: number; income: number; path: number[] }

function safeRoute(engine: MineEngine): number[] {
  const g = engine.geometry;
  const angles = engine.ores.slice(0, 16).map(ore => Math.atan2(ore.x - g.pivotX, ore.y - g.pivotY));
  const contacts = angles.map(angle => engine.ores.map(ore => rayContact(angle, ore, g)));
  let frontier: SafeRoute[] = [{ mask: 0, angle: engine.angle, direction: engine.direction, time: 0, income: 0, path: [] }];
  for (let depth = 0; depth < 16; depth++) {
    const next = new Map<string, SafeRoute>();
    for (const state of frontier) {
      for (let index = 0; index < 16; index++) {
        if (state.mask & (1 << index)) continue;
        const angle = angles[index]!;
        const distance = contacts[index]![index]!;
        if (contacts[index]!.some((hit, other) => other !== index && !(state.mask & (1 << other)) && hit !== null && hit < distance)) continue;
        let current = state.angle + state.direction * PHYSICS.swingSpeed * 0.25;
        let direction = state.direction;
        if (current > g.maxAngle) { current = 2 * g.maxAngle - current; direction = -1; }
        if (current < -g.maxAngle) { current = -2 * g.maxAngle - current; direction = 1; }
        const forward = (angle - current) * direction >= 0;
        const wait = (forward ? Math.abs(angle - current) : Math.abs(direction * g.maxAngle - current) + Math.abs(direction * g.maxAngle - angle)) / PHYSICS.swingSpeed;
        if (!forward) direction *= -1;
        const travel = (distance - g.minRope) / g.speedScale *
          (1 / PHYSICS.launchSpeed + Math.sqrt(ORE_TYPES[engine.ores[index]!.kind].weight) / PHYSICS.carrySpeed);
        const candidate: SafeRoute = { mask: state.mask | (1 << index), angle, direction,
          time: state.time + 0.25 + wait + travel + 1 / 60,
          income: state.income + oreValue(engine.ores[index]!), path: [...state.path, index] };
        if (candidate.time >= engine.level.duration) continue;
        if (candidate.income >= engine.level.target) return candidate.path;
        const key = `${candidate.mask}:${index}:${direction}`;
        if (!next.has(key) || next.get(key)!.time > candidate.time) next.set(key, candidate);
      }
    }
    frontier = [...next.values()].sort((a, b) => (a.time - a.income * 45 / engine.level.target) - (b.time - b.income * 45 / engine.level.target)).slice(0, 128);
  }
  assert.fail(`No conservative safe route for level ${engine.level.id}`);
}

function playSafeRoute(engine: MineEngine): void {
  for (const index of safeRoute(engine)) {
    engine.update(0.25);
    const target = engine.ores[index]!;
    const angle = Math.atan2(target.x - engine.geometry.pivotX, target.y - engine.geometry.pivotY);
    for (let step = 0; step < 1200; step++) {
      const forward = (angle - engine.angle) * engine.direction;
      if (forward >= 0 && forward <= PHYSICS.swingSpeed / 120) {
        engine.update(forward / PHYSICS.swingSpeed);
        break;
      }
      engine.update(1 / 120);
    }
    assert.ok(Math.abs(engine.angle - angle) < 1e-8);
    assert.equal(engine.launch(), true);
    while (engine.phase === 'out' && !engine.ended) engine.update(1 / 120);
    assert.equal(engine.held?.id, target.id, `round ${engine.level.id} keeps its upper route clear`);
    while (engine.phase === 'loaded' && !engine.ended) engine.update(1 / 120);
  }
  assert.ok(engine.timeLeft > 0);
  assert.ok(engine.income >= engine.level.target);
  assert.equal(engine.finish(), true);
  assert.equal(engine.won, true);
}

test('every new campaign level has an executable safe route without upgrades in either orientation', () => {
  for (const level of LEVELS.slice(20)) {
    for (const viewport of [null, { width: 720, height: 740, portrait: true }, { width: 720, height: 1400, portrait: true }]) {
      const engine = new MineEngine(level);
      if (viewport) engine.setViewport(viewport);
      playSafeRoute(engine);
    }
  }
});

test('high endless targets remain achievable while the elf and pigs are moving', () => {
  for (const index of [0, 999, MAX_ENDLESS_LEVEL - 1]) {
    for (const seed of [1, 987654321]) {
      const engine = new MineEngine(generateEndlessLevel(index, seed));
      engine.setViewport({ width: 720, height: 1040, portrait: true });
      playSafeRoute(engine);
    }
  }
});

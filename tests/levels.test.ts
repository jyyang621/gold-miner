import assert from 'node:assert/strict';
import test from 'node:test';
import { LEVELS, ORE_TYPES, oreValue, type LevelDefinition, type OreDefinition } from '../src/levels.ts';

const ORIGINAL_LEVELS = LEVELS.slice(0, 20);

const MAX_ANGLE = Math.PI * 75 / 180;
const SWING_SPEED = 1.05;
const MIN_ROPE = 38;
const MAX_ROPE = 760;
const HEAD_RADIUS = 8;
const REACTION = 0.25;

function guaranteedValue(ore: OreDefinition): number {
  return ore.kind === 'bag' ? 100 : oreValue(ore, false);
}

interface RouteState {
  mask: number;
  angle: number;
  direction: number;
  income: number;
  time: number;
  path: number[];
}

function firstCollision(level: LevelDefinition, mask: number, angle: number) {
  const sx = Math.sin(angle);
  const cy = Math.cos(angle);
  let nearest: { index: number; length: number } | undefined;
  level.ores.forEach((ore, index) => {
    if ((mask & 2 ** index) !== 0) return;
    const x = ore.x - 640;
    const y = ore.y - 148;
    const projection = x * sx + y * cy;
    const perpendicular2 = x * x + y * y - projection * projection;
    const radius = ore.radius + HEAD_RADIUS;
    if (perpendicular2 > radius * radius || projection < 0) return;
    const length = Math.max(MIN_ROPE, projection - Math.sqrt(Math.max(0, radius * radius - perpendicular2)));
    if (length > MAX_ROPE || (nearest && length >= nearest.length)) return;
    nearest = { index, length };
  });
  return nearest;
}

function swingPhase(angle: number, direction: number): number {
  return direction > 0 ? angle + MAX_ANGLE : 3 * MAX_ANGLE - angle;
}

// A bounded search for an executable witness, not a claim of optimal play.
// It considers center aim only, both swing directions, and all earlier blockers.
export function findUnboostedRoute(level: LevelDefinition): RouteState | undefined {
  let beam: RouteState[] = [{ mask: 0, angle: -0.85, direction: 1, income: 0, time: 0, path: [] }];
  const period = 4 * MAX_ANGLE;
  for (let depth = 0; depth < level.ores.length; depth++) {
    const next = new Map<number, RouteState>();
    const completed: RouteState[] = [];
    for (const state of beam) {
      const readyPhase = (swingPhase(state.angle, state.direction) + REACTION * SWING_SPEED) % period;
      for (let index = 0; index < level.ores.length; index++) {
        if ((state.mask & 2 ** index) !== 0) continue;
        const ore = level.ores[index]!;
        const angle = Math.atan2(ore.x - 640, ore.y - 148);
        if (Math.abs(angle) > MAX_ANGLE) continue;
        const hit = firstCollision(level, state.mask, angle);
        if (!hit || hit.index !== index) continue;
        const distance = Math.max(0, hit.length - MIN_ROPE);
        const travel = distance / 780 + distance / (520 / Math.sqrt(ORE_TYPES[ore.kind].weight));
        for (const direction of [1, -1]) {
          const targetPhase = swingPhase(angle, direction);
          const phaseDistance = (targetPhase - readyPhase + period) % period;
          const time = state.time + REACTION + phaseDistance / SWING_SPEED + travel;
          if (time > level.duration) continue;
          const candidate: RouteState = {
            mask: state.mask | 2 ** index,
            angle,
            direction,
            income: state.income + guaranteedValue(ore),
            time,
            path: [...state.path, index],
          };
          if (candidate.income >= level.target) {
            completed.push(candidate);
            continue;
          }
          const key = candidate.mask * 64 + index * 2 + (direction > 0 ? 1 : 0);
          const previous = next.get(key);
          if (!previous || candidate.time < previous.time) next.set(key, candidate);
        }
      }
    }
    if (completed.length) return completed.sort((a, b) => a.time - b.time)[0];
    beam = [...next.values()]
      .sort((a, b) => (a.time - a.income * 45 / level.target) - (b.time - b.income * 45 / level.target))
      .slice(0, 96);
    if (!beam.length) break;
  }
  return undefined;
}

test('20 consecutive, deterministic, one-minute levels introduce diamonds and bags in order', () => {
  assert.equal(ORIGINAL_LEVELS.length, 20);
  assert.deepEqual(ORIGINAL_LEVELS.map((level) => level.id), Array.from({ length: 20 }, (_, i) => i + 1));
  for (const level of ORIGINAL_LEVELS) {
    assert.equal(level.duration, 60);
    assert.ok(level.ores.length >= 14 && level.ores.length <= 26);
    if (level.id <= 2) assert.ok(level.ores.every((ore) => ore.kind !== 'diamond'));
    if (level.id < 5) assert.ok(level.ores.every((ore) => ore.kind !== 'bag'));
    if (level.id > 1) assert.ok(level.target > LEVELS[level.id - 2]!.target);
  }
  assert.ok(LEVELS[2]!.ores.some((ore) => ore.kind === 'diamond'));
  assert.ok(LEVELS[4]!.ores.some((ore) => ore.kind === 'bag'));
  assert.equal(LEVELS[19]!.target, 5000);
});

test('all item circles are inside the mine, reachable and separated', () => {
  const ids = new Set<string>();
  for (const level of LEVELS) {
    for (let i = 0; i < level.ores.length; i++) {
      const ore = level.ores[i]!;
      assert.ok(!ids.has(ore.id), `duplicate ${ore.id}`);
      ids.add(ore.id);
      assert.ok(ore.x >= 80 && ore.x <= 1200 && ore.y >= 300 && ore.y <= 655, ore.id);
      assert.ok(ore.x - ore.radius >= 0 && ore.x + ore.radius <= 1280, ore.id);
      assert.ok(ore.y - ore.radius >= 260 && ore.y + ore.radius <= 720, ore.id);
      assert.ok(Math.abs(Math.atan2(ore.x - 640, ore.y - 148)) <= MAX_ANGLE, ore.id);
      assert.ok(Math.hypot(ore.x - 640, ore.y - 148) - ore.radius - HEAD_RADIUS <= MAX_ROPE, ore.id);
      for (let j = i + 1; j < level.ores.length; j++) {
        const other = level.ores[j]!;
        assert.ok(Math.hypot(ore.x - other.x, ore.y - other.y) >= ore.radius + other.radius + 6,
          `overlapping ${ore.id} / ${other.id}`);
      }
    }
  }
});

test('bag floor and diamond boost values are explicit; every mine has ample guaranteed value', () => {
  for (const level of LEVELS) {
    assert.ok(level.ores.reduce((sum, ore) => sum + guaranteedValue(ore), 0) >= level.target * 1.5, `level ${level.id}`);
    for (const ore of level.ores) {
      if (ore.kind === 'bag') {
        assert.ok([100, 300, 600].includes(ore.bagValue!));
        assert.equal(oreValue({ ...ore, bagValue: undefined }), 100);
      }
      if (ore.kind === 'diamond') {
        assert.equal(oreValue(ore), 600);
        assert.equal(oreValue(ore, true), 900);
      }
    }
  }
});

test('all 20 mines have a path-aware route within 60 seconds, with no upgrades and bags worth only 100', () => {
  const summaries: string[] = [];
  for (const level of ORIGINAL_LEVELS) {
    const route = findUnboostedRoute(level);
    assert.ok(route, `level ${level.id} has no verified route`);
    assert.ok(route.time < level.duration);
    assert.ok(route.income >= level.target);
    // Replay each shot independently, to ensure the route never skips a blocker.
    let mask = 0;
    for (const index of route.path) {
      const ore = level.ores[index]!;
      assert.equal(firstCollision(level, mask, Math.atan2(ore.x - 640, ore.y - 148))?.index, index);
      mask |= 2 ** index;
    }
    summaries.push(`${level.id}: ${route.time.toFixed(2)}s / ${route.income} / [${route.path.map((i) => i + 1).join(', ')}]`);
  }
  console.log('Verified conservative routes (1-based item slots):\n' + summaries.join('\n'));
});

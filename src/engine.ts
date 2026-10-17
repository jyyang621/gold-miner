import { ORE_TYPES, oreValue, type LevelDefinition, type OreDefinition } from './levels.ts';
import { WIDE_VIEWPORT, mineGeometry, mineScale, type MineGeometry, type MineViewport } from './viewport.ts';

export const PHYSICS = {
  pivotX: 640, pivotY: 148, minRope: 38, maxRope: 760,
  maxAngle: Math.PI * 75 / 180, swingSpeed: 1.05,
  launchSpeed: 780, returnSpeed: 960, carrySpeed: 520, headRadius: 8,
} as const;

export type HookPhase = 'swing' | 'out' | 'empty' | 'loaded';
export interface RuntimeOre extends OreDefinition { removed: boolean; held: boolean; motionDirection: 1 | -1 }
export interface MineEvent { type: 'launch' | 'grab' | 'coin' | 'rock' | 'bomb' | 'blast' | 'dig' | 'end'; x: number; y: number; value?: number; won?: boolean; player?: 0 | 1; radiusX?: number; radiusY?: number }
export interface MinePlayer {
  id: 0 | 1;
  angle: number;
  direction: number;
  rope: number;
  phase: HookPhase;
  held: RuntimeOre | null;
  income: number;
}
export interface MineOptions {
  bombs?: number;
  strength?: boolean;
  diamondBonus?: boolean;
  playerCount?: 1 | 2;
  /** When supplied, each player can only use their own stock (versus mode). */
  bombStocks?: readonly [number, number];
}

/** Barrel explosions are measured in the original mine, in either orientation. */
export const BARREL_BLAST_RADIUS = 140;
const DYNAMIC_STEP = 1 / 120;
interface MotionSegment { from: number; to: number; x: number; vx: number; direction: 1 | -1 }
interface MotionPlan { segments: MotionSegment[]; x: number; direction: 1 | -1 }

/** Earliest circle intersection for two linearly moving centres. */
function circleContact(x: number, y: number, vx: number, vy: number, radius: number, duration: number): number | null {
  const c = x * x + y * y - radius * radius;
  if (c <= 1e-8) return 0;
  const a = vx * vx + vy * vy;
  if (a <= 1e-16) return null;
  const b = x * vx + y * vy;
  if (b >= 0) return null;
  const discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const time = (-b - Math.sqrt(Math.max(0, discriminant))) / a;
  return time >= -1e-10 && time <= duration + 1e-10 ? Math.max(0, Math.min(duration, time)) : null;
}

/** First contact distance along a ray; the rope itself has no collision. */
export function rayContact(angle: number, ore: OreDefinition, geometry: Pick<MineGeometry, 'pivotX' | 'pivotY'> = PHYSICS): number | null {
  const dx = Math.sin(angle), dy = Math.cos(angle);
  const x = ore.x - geometry.pivotX, y = ore.y - geometry.pivotY;
  const projection = x * dx + y * dy;
  const radius = ore.radius + PHYSICS.headRadius;
  const perpendicularSquared = x * x + y * y - projection * projection;
  if (projection < 0 || perpendicularSquared > radius * radius) return null;
  return Math.max(0, projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared)));
}

export class MineEngine {
  readonly level: LevelDefinition;
  readonly ores: RuntimeOre[];
  readonly players: readonly MinePlayer[];
  readonly playerCount: 1 | 2;
  viewport: MineViewport = { ...WIDE_VIEWPORT };
  timeLeft: number;
  income = 0;
  bombs: number;
  readonly bombStocks: [number, number] | null;
  readonly strength: boolean;
  readonly diamondBonus: boolean;
  ended = false;
  won = false;
  private events: MineEvent[] = [];
  private readonly dynamic: boolean;

  constructor(level: LevelDefinition, options: MineOptions = {}) {
    this.level = level;
    this.ores = level.ores.map(ore => Object.defineProperty({ ...ore, removed: false, held: false }, 'motionDirection', {
      value: ore.motion?.direction === -1 ? -1 : 1, writable: true,
    }) as RuntimeOre);
    this.dynamic = this.ores.some(ore => ore.motion !== undefined || ore.kind === 'barrel' || ore.kind === 'elf');
    this.playerCount = options.playerCount ?? 1;
    this.players = Array.from({ length: this.playerCount }, (_, index) => ({
      id: index as 0 | 1, angle: index === 0 ? -0.85 : 0.85, direction: index === 0 ? 1 : -1,
      rope: PHYSICS.minRope, phase: 'swing' as HookPhase, held: null, income: 0,
    }));
    this.timeLeft = level.duration;
    this.bombStocks = options.bombStocks ? [...options.bombStocks] : null;
    this.bombs = this.bombStocks ? this.bombStocks.slice(0, this.playerCount).reduce((total, stock) => total + stock, 0) : options.bombs ?? 0;
    this.strength = options.strength ?? false;
    this.diamondBonus = options.diamondBonus ?? false;
  }

  // Keep the original one-player API as aliases of the first hook.
  get angle() { return this.players[0]!.angle; }
  set angle(value: number) { this.players[0]!.angle = value; }
  get direction() { return this.players[0]!.direction; }
  set direction(value: number) { this.players[0]!.direction = value; }
  get rope() { return this.players[0]!.rope; }
  set rope(value: number) { this.players[0]!.rope = value; }
  get phase() { return this.players[0]!.phase; }
  set phase(value: HookPhase) { this.players[0]!.phase = value; }
  get held() { return this.players[0]!.held; }
  set held(value: RuntimeOre | null) { this.players[0]!.held = value; }
  get geometry() { return mineGeometry(this.viewport); }
  playerGeometry(index = 0): MineGeometry {
    const geometry = this.geometry;
    if (this.playerCount === 2) geometry.pivotX = this.viewport.width * (index === 0 ? (this.viewport.portrait ? 0.32 : 0.35) : (this.viewport.portrait ? 0.68 : 0.65));
    return geometry;
  }
  playerHead(index = 0) {
    const player = this.players[index];
    if (!player) throw new RangeError('Unknown player');
    const geometry = this.playerGeometry(index);
    return { x: geometry.pivotX + Math.sin(player.angle) * player.rope, y: geometry.pivotY + Math.cos(player.angle) * player.rope };
  }
  get head() { return this.playerHead(); }
  get canFinish() { return !this.ended && this.income >= this.level.target && this.players.every(player => player.phase === 'swing'); }
  canBombFor(index = 0) {
    const player = this.players[index];
    return !this.ended && !!player && player.phase === 'loaded' && (this.bombStocks?.[index] ?? this.bombs) > 0;
  }
  get canBomb() { return this.canBombFor(); }

  /** Change the mine's shape without restarting the active shot or level. */
  setViewport(view: MineViewport): void {
    if (!Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width < 320 || view.height < 360) return;
    if (this.viewport.width === view.width && this.viewport.height === view.height && this.viewport.portrait === view.portrait) return;
    const before = this.geometry;
    const beforePlayers = this.players.map(player => this.playerGeometry(player.id));
    const oldScale = mineScale(this.viewport), nextScale = mineScale(view);
    const vectors = this.players.map(player => ({ x: Math.sin(player.angle) * player.rope, y: Math.cos(player.angle) * player.rope }));
    this.viewport = { ...view };
    const geometry = this.geometry;
    for (const ore of this.ores) {
      // Transform the current position, including a walking actor, rather than
      // restoring its level-start position when the phone rotates.
      ore.x = geometry.pivotX + (ore.x - before.pivotX) * nextScale.x / oldScale.x;
      ore.y = geometry.pivotY + (ore.y - before.pivotY) * nextScale.y / oldScale.y;
    }
    for (const player of this.players) {
      const vector = vectors[player.id]!;
      const x = vector.x * nextScale.x / oldScale.x;
      const y = vector.y * nextScale.y / oldScale.y;
      player.angle = Math.atan2(x, y);
      if (player.phase === 'swing') {
        // Idle hooks stay at their own winches; only their aim changes.
        player.angle = Math.max(-geometry.maxAngle, Math.min(geometry.maxAngle, player.angle));
        player.rope = geometry.minRope;
      } else {
        player.rope = Math.max(geometry.minRope, Math.hypot(x, y));
      }
    }
    // Pending effects follow the same transformation when rotation happens
    // between the physics update and rendering.
    this.events = this.events.map(event => {
      const from = event.player === undefined ? before : beforePlayers[event.player]!;
      const to = event.player === undefined ? geometry : this.playerGeometry(event.player);
      return { ...event,
        x: to.pivotX + (event.x - from.pivotX) * nextScale.x / oldScale.x,
        y: to.pivotY + (event.y - from.pivotY) * nextScale.y / oldScale.y,
        ...(event.radiusX === undefined ? {} : { radiusX: event.radiusX * nextScale.x / oldScale.x }),
        ...(event.radiusY === undefined ? {} : { radiusY: event.radiusY * nextScale.y / oldScale.y }),
      };
    });
  }

  launch(index = 0): boolean {
    const player = this.players[index];
    if (this.ended || !player || player.phase !== 'swing') return false;
    player.phase = 'out';
    this.events.push({type:'launch', ...this.playerHead(index), player: player.id});
    return true;
  }

  bomb(index = 0): boolean {
    const player = this.players[index];
    if (!this.canBombFor(index) || !player?.held) return false;
    this.events.push({type:'bomb', ...this.playerHead(index), player: player.id});
    this.bombs--;
    if (this.bombStocks) this.bombStocks[index]!--;
    player.held.removed = true;
    player.held.held = false;
    player.held = null;
    player.phase = 'empty';
    return true;
  }

  finish(): boolean {
    if (!this.canFinish) return false;
    this.end();
    return true;
  }

  update(delta: number): void {
    if (this.ended || delta <= 0 || !Number.isFinite(delta)) return;
    if (this.dynamic) {
      // Large updates use the same small simulation steps as normal play.
      // The swept contacts below also cover actors crossing between steps.
      let remaining = Math.min(delta, this.timeLeft);
      while (remaining > 1e-10 && !this.ended) {
        const dt = Math.min(DYNAMIC_STEP, remaining);
        this.updateDynamic(dt);
        remaining -= dt;
      }
      return;
    }
    this.updateStatic(delta);
  }

  private updateStatic(delta: number): void {
    const dt = Math.min(delta, this.timeLeft);
    const outgoing: { player: MinePlayer; next: number; edge: number }[] = [];
    const contacts: { player: MinePlayer; ore: RuntimeOre; distance: number; time: number; order: number }[] = [];
    for (const player of this.players) {
      const geometry = this.playerGeometry(player.id);
      if (player.phase === 'swing') {
        player.angle += player.direction * PHYSICS.swingSpeed * dt;
        if (player.angle > geometry.maxAngle) {player.angle = 2 * geometry.maxAngle - player.angle; player.direction = -1;}
        if (player.angle < -geometry.maxAngle) {player.angle = -2 * geometry.maxAngle - player.angle; player.direction = 1;}
      } else if (player.phase === 'out') {
        const sx = Math.sin(player.angle), cy = Math.cos(player.angle);
        const edge = Math.min(geometry.maxRope, (geometry.bounds.bottom - geometry.pivotY) / cy,
          Math.abs(sx) < 0.00001 ? Infinity : (sx > 0 ? geometry.bounds.right - geometry.pivotX : geometry.pivotX - geometry.bounds.left) / Math.abs(sx));
        const speed = PHYSICS.launchSpeed * geometry.speedScale;
        const next = Math.max(player.rope, Math.min(edge, player.rope + speed * dt));
        const head = this.playerHead(player.id);
        outgoing.push({ player, next, edge });
        for (const [order, ore] of this.ores.entries()) {
          if (ore.removed || ore.held) continue;
          const distance = rayContact(player.angle, ore, geometry);
          // Rotation can place a hook inside a circle that has kept its size.
          const inside = Math.hypot(head.x - ore.x, head.y - ore.y) <= ore.radius + PHYSICS.headRadius;
          const contact = inside ? player.rope : distance;
          if (contact !== null && contact >= player.rope - 0.01 && contact <= next) {
            contacts.push({ player, ore, distance: contact, time: Math.max(0, contact - player.rope) / speed, order });
          }
        }
      } else {
        const speed = player.held ? PHYSICS.carrySpeed / Math.sqrt(ORE_TYPES[player.held.kind].weight) * (this.strength ? 1.35 : 1) : PHYSICS.returnSpeed;
        player.rope = Math.max(geometry.minRope, player.rope - speed * geometry.speedScale * dt);
        if (player.rope <= geometry.minRope + 1e-8) {
          player.rope = geometry.minRope;
          if (player.held) {
            const value = oreValue(player.held, this.diamondBonus);
            this.income += value;
            player.income += value;
            player.held.removed = true; player.held.held = false; player.held = null;
            this.events.push({type:'coin', ...this.playerHead(player.id), value, player: player.id});
          }
          player.phase = 'swing';
        }
      }
    }
    // Resolve contacts across both hooks by arrival time, rather than by player
    // update order. A skipped (already claimed) ore does not block a later one.
    contacts.sort((a, b) => a.time - b.time || a.player.id - b.player.id || a.order - b.order);
    for (const { player, ore, distance } of contacts) {
      if (player.phase !== 'out' || ore.removed || ore.held) continue;
      player.rope = distance;
      player.held = ore; ore.held = true; player.phase = 'loaded';
      this.events.push({type: ORE_TYPES[ore.kind].value <= 20 ? 'rock' : 'grab', ...this.playerHead(player.id), player: player.id});
    }
    for (const { player, next, edge } of outgoing) {
      if (player.phase !== 'out') continue;
      player.rope = next;
      if (next >= edge) player.phase = 'empty';
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0 || (this.players.every(player => player.phase === 'swing') && this.ores.every(ore => ore.removed))) this.end();
  }

  private planMotion(ore: RuntimeOre, dt: number): MotionPlan {
    const motion = ore.motion!;
    const scale = mineScale(this.viewport).x;
    const left = this.geometry.pivotX + (motion.left - PHYSICS.pivotX) * scale;
    const right = this.geometry.pivotX + (motion.right - PHYSICS.pivotX) * scale;
    const speed = motion.speed * scale;
    let x = Math.max(left, Math.min(right, ore.x));
    let direction = ore.motionDirection;
    if (!(right - left > 1e-8) || !(speed > 0) || !Number.isFinite(speed)) {
      return { segments: [{ from: 0, to: dt, x: ore.x, vx: 0, direction }], x: ore.x, direction };
    }
    let time = 0;
    const segments: MotionSegment[] = [];
    while (time < dt - 1e-12) {
      const distance = direction === 1 ? right - x : x - left;
      if (distance <= 1e-10) { direction = direction === 1 ? -1 : 1; continue; }
      const duration = Math.min(dt - time, distance / speed);
      const vx = speed * direction;
      segments.push({ from: time, to: time + duration, x, vx, direction });
      x = Math.max(left, Math.min(right, x + vx * duration));
      time += duration;
      if (duration >= distance / speed - 1e-12) direction = direction === 1 ? -1 : 1;
    }
    return { segments, x, direction };
  }

  private positionAt(ore: RuntimeOre, time: number, plans: Map<RuntimeOre, MotionPlan>) {
    const plan = plans.get(ore);
    if (!plan) return { x: ore.x, y: ore.y, direction: ore.motionDirection };
    const segment = plan.segments.find(item => time < item.to - 1e-10);
    if (!segment) return { x: plan.x, y: ore.y, direction: plan.direction };
    return { x: segment.x + segment.vx * Math.max(0, time - segment.from), y: ore.y, direction: segment.direction };
  }

  private hookContact(player: MinePlayer, next: number, ore: RuntimeOre, plans: Map<RuntimeOre, MotionPlan>, dt: number): number | null {
    const geometry = this.playerGeometry(player.id);
    const speed = PHYSICS.launchSpeed * geometry.speedScale;
    const head = this.playerHead(player.id);
    const vx = Math.sin(player.angle) * speed, vy = Math.cos(player.angle) * speed;
    const travelTime = Math.min(dt, Math.max(0, next - player.rope) / speed);
    const segments = plans.get(ore)?.segments ?? [{ from: 0, to: dt, x: ore.x, vx: 0, direction: ore.motionDirection }];
    let earliest: number | null = null;
    for (const segment of segments) {
      const from = segment.from, to = Math.min(travelTime, segment.to);
      if (from > to + 1e-10) continue;
      const contact = circleContact(head.x + vx * from - segment.x, head.y + vy * from - ore.y,
        vx - segment.vx, vy, ore.radius + PHYSICS.headRadius, Math.max(0, to - from));
      if (contact !== null && (earliest === null || from + contact < earliest)) earliest = from + contact;
    }
    return earliest;
  }

  private elfContact(elf: RuntimeOre, ore: RuntimeOre, plans: Map<RuntimeOre, MotionPlan>, dt: number): number | null {
    const elfSegments = plans.get(elf)?.segments ?? [{ from: 0, to: dt, x: elf.x, vx: 0, direction: elf.motionDirection }];
    const oreSegments = plans.get(ore)?.segments ?? [{ from: 0, to: dt, x: ore.x, vx: 0, direction: ore.motionDirection }];
    let earliest: number | null = null;
    for (const a of elfSegments) {
      for (const b of oreSegments) {
        const from = Math.max(a.from, b.from), to = Math.min(a.to, b.to);
        if (from > to + 1e-10) continue;
        const contact = circleContact(a.x + a.vx * (from - a.from) - b.x - b.vx * (from - b.from),
          elf.y - ore.y, a.vx - b.vx, 0, elf.radius + ore.radius, Math.max(0, to - from));
        if (contact !== null && (earliest === null || from + contact < earliest)) earliest = from + contact;
      }
    }
    return earliest;
  }

  private explode(barrel: RuntimeOre, time: number, plans: Map<RuntimeOre, MotionPlan>): void {
    const scale = mineScale(this.viewport);
    const queue = [barrel];
    while (queue.length) {
      const source = queue.shift()!;
      if (source.removed || source.held) continue;
      const centre = this.positionAt(source, time, plans);
      source.x = centre.x; source.y = centre.y; source.removed = true;
      this.events.push({ type: 'blast', x: centre.x, y: centre.y,
        radiusX: BARREL_BLAST_RADIUS * scale.x, radiusY: BARREL_BLAST_RADIUS * scale.y });
      for (const ore of this.ores) {
        // A player has already secured anything hanging from a hook.
        if (ore.removed || ore.held) continue;
        const position = this.positionAt(ore, time, plans);
        const distance = Math.hypot((position.x - centre.x) / scale.x, (position.y - centre.y) / scale.y);
        if (distance > BARREL_BLAST_RADIUS + ore.radius) continue;
        if (ore.kind === 'barrel') queue.push(ore);
        else { ore.x = position.x; ore.y = position.y; ore.removed = true; }
      }
    }
  }

  private updateDynamic(dt: number): void {
    const plans = new Map<RuntimeOre, MotionPlan>();
    for (const ore of this.ores) {
      if (!ore.removed && !ore.held && ore.motion) plans.set(ore, this.planMotion(ore, dt));
    }
    const outgoing: { player: MinePlayer; next: number; edge: number; speed: number; rope: number }[] = [];
    type Contact = { kind: 'hook'; player: MinePlayer; ore: RuntimeOre; time: number; order: number } |
      { kind: 'dig'; elf: RuntimeOre; ore: RuntimeOre; time: number; order: number };
    const contacts: Contact[] = [];
    for (const player of this.players) {
      const geometry = this.playerGeometry(player.id);
      if (player.phase === 'swing') {
        player.angle += player.direction * PHYSICS.swingSpeed * dt;
        if (player.angle > geometry.maxAngle) { player.angle = 2 * geometry.maxAngle - player.angle; player.direction = -1; }
        if (player.angle < -geometry.maxAngle) { player.angle = -2 * geometry.maxAngle - player.angle; player.direction = 1; }
      } else if (player.phase === 'out') {
        const sx = Math.sin(player.angle), cy = Math.cos(player.angle);
        const edge = Math.min(geometry.maxRope, (geometry.bounds.bottom - geometry.pivotY) / cy,
          Math.abs(sx) < 0.00001 ? Infinity : (sx > 0 ? geometry.bounds.right - geometry.pivotX : geometry.pivotX - geometry.bounds.left) / Math.abs(sx));
        const speed = PHYSICS.launchSpeed * geometry.speedScale;
        const next = Math.max(player.rope, Math.min(edge, player.rope + speed * dt));
        outgoing.push({ player, next, edge, speed, rope: player.rope });
        for (const [order, ore] of this.ores.entries()) {
          if (ore.removed || ore.held) continue;
          const time = this.hookContact(player, next, ore, plans, dt);
          if (time !== null) contacts.push({ kind: 'hook', player, ore, time, order });
        }
      } else {
        const speed = player.held ? PHYSICS.carrySpeed / Math.sqrt(ORE_TYPES[player.held.kind].weight) * (this.strength ? 1.35 : 1) : PHYSICS.returnSpeed;
        player.rope = Math.max(geometry.minRope, player.rope - speed * geometry.speedScale * dt);
        if (player.rope <= geometry.minRope + 1e-8) {
          player.rope = geometry.minRope;
          if (player.held) {
            const value = oreValue(player.held, this.diamondBonus);
            this.income += value; player.income += value;
            player.held.removed = true; player.held.held = false; player.held = null;
            this.events.push({ type: 'coin', ...this.playerHead(player.id), value, player: player.id });
          }
          player.phase = 'swing';
        }
      }
    }
    for (const elf of this.ores) {
      if (elf.kind !== 'elf' || elf.removed || elf.held) continue;
      for (const [order, ore] of this.ores.entries()) {
        if (ore.kind === 'elf' || ore.removed || ore.held) continue;
        const time = this.elfContact(elf, ore, plans, dt);
        if (time !== null) contacts.push({ kind: 'dig', elf, ore, time, order });
      }
    }
    // Hooks and miners share a timeline: grabbing an actor stops its later
    // mining, and a blast cannot destroy an item that a hook secured first.
    contacts.sort((a, b) => a.time - b.time ||
      (a.kind === b.kind ? 0 : a.kind === 'hook' ? -1 : 1) ||
      (a.kind === 'hook' && b.kind === 'hook' ? a.player.id - b.player.id : 0) || a.order - b.order);
    for (const contact of contacts) {
      const { ore, time } = contact;
      if (ore.removed || ore.held) continue;
      if (contact.kind === 'hook') {
        const { player } = contact;
        if (player.phase !== 'out') continue;
        const shot = outgoing.find(item => item.player === player)!;
        player.rope = shot.rope + shot.speed * time;
        const position = this.positionAt(ore, time, plans);
        ore.x = position.x; ore.y = position.y; ore.motionDirection = position.direction;
        if (ore.kind === 'barrel') {
          player.phase = 'empty';
          this.explode(ore, time, plans);
        } else {
          player.held = ore; ore.held = true; player.phase = 'loaded';
          this.events.push({ type: ORE_TYPES[ore.kind].value <= 20 ? 'rock' : 'grab', ...this.playerHead(player.id), player: player.id });
        }
      } else {
        if (contact.elf.removed || contact.elf.held) continue;
        if (ore.kind === 'barrel') this.explode(ore, time, plans);
        else {
          const position = this.positionAt(ore, time, plans);
          ore.x = position.x; ore.y = position.y; ore.removed = true;
          this.events.push({ type: 'dig', x: position.x, y: position.y });
        }
      }
    }
    for (const { player, next, edge } of outgoing) {
      if (player.phase !== 'out') continue;
      player.rope = next;
      if (next >= edge) player.phase = 'empty';
    }
    for (const [ore, plan] of plans) {
      if (ore.removed || ore.held) continue;
      ore.x = plan.x; ore.motionDirection = plan.direction;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft < 1e-9) this.timeLeft = 0;
    if (this.timeLeft === 0 || (this.players.every(player => player.phase === 'swing') && this.ores.every(ore => ore.removed))) this.end();
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.won = this.income >= this.level.target;
    this.events.push({type:'end', x:this.viewport.width / 2, y:this.viewport.height / 2, won:this.won});
  }

  drainEvents(): MineEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

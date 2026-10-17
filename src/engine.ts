import { ORE_TYPES, oreValue, type LevelDefinition, type OreDefinition } from './levels.ts';

export const PHYSICS = {
  pivotX: 640, pivotY: 148, minRope: 38, maxRope: 760,
  maxAngle: Math.PI * 75 / 180, swingSpeed: 1.05,
  launchSpeed: 780, returnSpeed: 960, carrySpeed: 520, headRadius: 8,
} as const;

export type HookPhase = 'swing' | 'out' | 'empty' | 'loaded';
export interface RuntimeOre extends OreDefinition { removed: boolean; held: boolean }
export interface MineEvent { type: 'launch' | 'grab' | 'coin' | 'rock' | 'bomb' | 'end'; x: number; y: number; value?: number; won?: boolean }

/** First contact distance along a ray; the rope itself has no collision. */
export function rayContact(angle: number, ore: OreDefinition): number | null {
  const dx = Math.sin(angle), dy = Math.cos(angle);
  const x = ore.x - PHYSICS.pivotX, y = ore.y - PHYSICS.pivotY;
  const projection = x * dx + y * dy;
  const radius = ore.radius + PHYSICS.headRadius;
  const perpendicularSquared = x * x + y * y - projection * projection;
  if (projection < 0 || perpendicularSquared > radius * radius) return null;
  return Math.max(0, projection - Math.sqrt(Math.max(0, radius * radius - perpendicularSquared)));
}

export class MineEngine {
  readonly level: LevelDefinition;
  readonly ores: RuntimeOre[];
  angle = -0.85;
  direction = 1;
  rope = PHYSICS.minRope as number;
  phase: HookPhase = 'swing';
  held: RuntimeOre | null = null;
  timeLeft: number;
  income = 0;
  bombs: number;
  readonly strength: boolean;
  readonly diamondBonus: boolean;
  ended = false;
  won = false;
  private events: MineEvent[] = [];

  constructor(level: LevelDefinition, options: {bombs?: number; strength?: boolean; diamondBonus?: boolean} = {}) {
    this.level = level;
    this.ores = level.ores.map(ore => ({...ore, removed: false, held: false}));
    this.timeLeft = level.duration;
    this.bombs = options.bombs ?? 0;
    this.strength = options.strength ?? false;
    this.diamondBonus = options.diamondBonus ?? false;
  }

  get head() { return {x: PHYSICS.pivotX + Math.sin(this.angle) * this.rope, y: PHYSICS.pivotY + Math.cos(this.angle) * this.rope}; }
  get canFinish() { return !this.ended && this.income >= this.level.target && this.phase === 'swing'; }
  get canBomb() { return !this.ended && this.phase === 'loaded' && this.bombs > 0; }

  launch(): boolean {
    if (this.ended || this.phase !== 'swing') return false;
    this.phase = 'out';
    this.events.push({type:'launch', ...this.head});
    return true;
  }

  bomb(): boolean {
    if (!this.canBomb || !this.held) return false;
    this.events.push({type:'bomb', ...this.head});
    this.bombs--;
    this.held.removed = true;
    this.held.held = false;
    this.held = null;
    this.phase = 'empty';
    return true;
  }

  finish(): boolean {
    if (!this.canFinish) return false;
    this.end();
    return true;
  }

  update(delta: number): void {
    if (this.ended || delta <= 0 || !Number.isFinite(delta)) return;
    const dt = Math.min(delta, this.timeLeft);
    if (this.phase === 'swing') {
      this.angle += this.direction * PHYSICS.swingSpeed * dt;
      if (this.angle > PHYSICS.maxAngle) {this.angle = 2 * PHYSICS.maxAngle - this.angle; this.direction = -1;}
      if (this.angle < -PHYSICS.maxAngle) {this.angle = -2 * PHYSICS.maxAngle - this.angle; this.direction = 1;}
    } else if (this.phase === 'out') {
      const sx = Math.sin(this.angle), cy = Math.cos(this.angle);
      const edge = Math.min(PHYSICS.maxRope, (690 - PHYSICS.pivotY) / cy,
        Math.abs(sx) < 0.00001 ? Infinity : (sx > 0 ? 1252 - PHYSICS.pivotX : PHYSICS.pivotX - 28) / Math.abs(sx));
      const next = Math.min(edge, this.rope + PHYSICS.launchSpeed * dt);
      let first: RuntimeOre | null = null, firstDistance = Infinity;
      for (const ore of this.ores) {
        if (ore.removed || ore.held) continue;
        const distance = rayContact(this.angle, ore);
        if (distance !== null && distance >= this.rope - 0.01 && distance <= next && distance < firstDistance) {
          first = ore; firstDistance = distance;
        }
      }
      if (first) {
        this.rope = firstDistance;
        this.held = first; first.held = true; this.phase = 'loaded';
        this.events.push({type: ORE_TYPES[first.kind].value <= 20 ? 'rock' : 'grab', ...this.head});
      } else {
        this.rope = next;
        if (next >= edge) this.phase = 'empty';
      }
    } else {
      const speed = this.held ? PHYSICS.carrySpeed / Math.sqrt(ORE_TYPES[this.held.kind].weight) * (this.strength ? 1.35 : 1) : PHYSICS.returnSpeed;
      this.rope = Math.max(PHYSICS.minRope, this.rope - speed * dt);
      if (this.rope <= PHYSICS.minRope + 1e-8) {
        this.rope = PHYSICS.minRope;
        if (this.held) {
          const value = oreValue(this.held, this.diamondBonus);
          this.income += value;
          this.held.removed = true; this.held.held = false; this.held = null;
          this.events.push({type:'coin', ...this.head, value});
        }
        this.phase = 'swing';
      }
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0 || (this.phase === 'swing' && this.ores.every(ore => ore.removed))) this.end();
  }

  private end(): void {
    if (this.ended) return;
    this.ended = true;
    this.won = this.income >= this.level.target;
    this.events.push({type:'end', x:640, y:360, won:this.won});
  }

  drainEvents(): MineEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

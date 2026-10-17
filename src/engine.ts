import { ORE_TYPES, oreValue, type LevelDefinition, type OreDefinition } from './levels.ts';
import { WIDE_VIEWPORT, mineGeometry, mineScale, type MineGeometry, type MineViewport } from './viewport.ts';

export const PHYSICS = {
  pivotX: 640, pivotY: 148, minRope: 38, maxRope: 760,
  maxAngle: Math.PI * 75 / 180, swingSpeed: 1.05,
  launchSpeed: 780, returnSpeed: 960, carrySpeed: 520, headRadius: 8,
} as const;

export type HookPhase = 'swing' | 'out' | 'empty' | 'loaded';
export interface RuntimeOre extends OreDefinition { removed: boolean; held: boolean }
export interface MineEvent { type: 'launch' | 'grab' | 'coin' | 'rock' | 'bomb' | 'end'; x: number; y: number; value?: number; won?: boolean }

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
  viewport: MineViewport = { ...WIDE_VIEWPORT };
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

  get geometry() { return mineGeometry(this.viewport); }
  get head() { const geometry = this.geometry; return {x: geometry.pivotX + Math.sin(this.angle) * this.rope, y: geometry.pivotY + Math.cos(this.angle) * this.rope}; }
  get canFinish() { return !this.ended && this.income >= this.level.target && this.phase === 'swing'; }
  get canBomb() { return !this.ended && this.phase === 'loaded' && this.bombs > 0; }

  /** Change the mine's shape without restarting the active shot or level. */
  setViewport(view: MineViewport): void {
    if (!Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width < 320 || view.height < 360) return;
    if (this.viewport.width === view.width && this.viewport.height === view.height && this.viewport.portrait === view.portrait) return;
    const before = this.geometry;
    const oldScale = mineScale(this.viewport), nextScale = mineScale(view);
    const vector = { x: Math.sin(this.angle) * this.rope, y: Math.cos(this.angle) * this.rope };
    this.viewport = { ...view };
    const geometry = this.geometry;
    for (const [index, ore] of this.ores.entries()) {
      const source = this.level.ores[index]!;
      ore.x = geometry.pivotX + (source.x - PHYSICS.pivotX) * nextScale.x;
      ore.y = geometry.pivotY + (source.y - PHYSICS.pivotY) * nextScale.y;
    }
    if (this.phase === 'swing') {
      // The idle hook stays at the winch; only its aim follows the new aspect.
      this.angle = Math.atan2(vector.x * nextScale.x / oldScale.x, vector.y * nextScale.y / oldScale.y);
      this.angle = Math.max(-geometry.maxAngle, Math.min(geometry.maxAngle, this.angle));
      this.rope = geometry.minRope;
    } else {
      const x = vector.x * nextScale.x / oldScale.x;
      const y = vector.y * nextScale.y / oldScale.y;
      this.angle = Math.atan2(x, y);
      this.rope = Math.max(geometry.minRope, Math.hypot(x, y));
    }
    // Pending effects follow the same transformation when rotation happens
    // between the physics update and rendering.
    this.events = this.events.map(event => ({ ...event,
      x: geometry.pivotX + (event.x - before.pivotX) * nextScale.x / oldScale.x,
      y: geometry.pivotY + (event.y - before.pivotY) * nextScale.y / oldScale.y,
    }));
  }

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
    const geometry = this.geometry;
    if (this.phase === 'swing') {
      this.angle += this.direction * PHYSICS.swingSpeed * dt;
      if (this.angle > geometry.maxAngle) {this.angle = 2 * geometry.maxAngle - this.angle; this.direction = -1;}
      if (this.angle < -geometry.maxAngle) {this.angle = -2 * geometry.maxAngle - this.angle; this.direction = 1;}
    } else if (this.phase === 'out') {
      const sx = Math.sin(this.angle), cy = Math.cos(this.angle);
      const edge = Math.min(geometry.maxRope, (geometry.bounds.bottom - geometry.pivotY) / cy,
        Math.abs(sx) < 0.00001 ? Infinity : (sx > 0 ? geometry.bounds.right - geometry.pivotX : geometry.pivotX - geometry.bounds.left) / Math.abs(sx));
      const next = Math.max(this.rope, Math.min(edge, this.rope + PHYSICS.launchSpeed * geometry.speedScale * dt));
      let first: RuntimeOre | null = null, firstDistance = Infinity;
      const head = this.head;
      for (const ore of this.ores) {
        if (ore.removed || ore.held) continue;
        const distance = rayContact(this.angle, ore, geometry);
        // Resizing can place the hook inside an expanded collision circle.
        const inside = Math.hypot(head.x - ore.x, head.y - ore.y) <= ore.radius + PHYSICS.headRadius;
        const contact = inside ? this.rope : distance;
        if (contact !== null && contact >= this.rope - 0.01 && contact <= next && contact < firstDistance) {
          first = ore; firstDistance = contact;
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
      this.rope = Math.max(geometry.minRope, this.rope - speed * geometry.speedScale * dt);
      if (this.rope <= geometry.minRope + 1e-8) {
        this.rope = geometry.minRope;
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
    this.events.push({type:'end', x:this.viewport.width / 2, y:this.viewport.height / 2, won:this.won});
  }

  drainEvents(): MineEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

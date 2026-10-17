import { ORE_TYPES, oreValue, type LevelDefinition, type OreDefinition } from './levels.ts';
import { WIDE_VIEWPORT, mineGeometry, mineScale, type MineGeometry, type MineViewport } from './viewport.ts';

export const PHYSICS = {
  pivotX: 640, pivotY: 148, minRope: 38, maxRope: 760,
  maxAngle: Math.PI * 75 / 180, swingSpeed: 1.05,
  launchSpeed: 780, returnSpeed: 960, carrySpeed: 520, headRadius: 8,
} as const;

export type HookPhase = 'swing' | 'out' | 'empty' | 'loaded';
export interface RuntimeOre extends OreDefinition { removed: boolean; held: boolean }
export interface MineEvent { type: 'launch' | 'grab' | 'coin' | 'rock' | 'bomb' | 'end'; x: number; y: number; value?: number; won?: boolean; player?: 0 | 1 }
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

  constructor(level: LevelDefinition, options: MineOptions = {}) {
    this.level = level;
    this.ores = level.ores.map(ore => ({...ore, removed: false, held: false}));
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
    for (const [index, ore] of this.ores.entries()) {
      const source = this.level.ores[index]!;
      ore.x = geometry.pivotX + (source.x - PHYSICS.pivotX) * nextScale.x;
      ore.y = geometry.pivotY + (source.y - PHYSICS.pivotY) * nextScale.y;
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

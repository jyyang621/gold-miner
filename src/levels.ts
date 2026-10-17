export type OreKind =
  | 'goldSmall'
  | 'goldMedium'
  | 'goldLarge'
  | 'diamond'
  | 'rockSmall'
  | 'rockLarge'
  | 'bag'
  | 'barrel'
  | 'pig'
  | 'diamondPig'
  | 'elf';

export interface OreDefinition {
  id: string;
  kind: OreKind;
  x: number;
  y: number;
  radius: number;
  bagValue?: number;
  /** Horizontal travel limits and speed, expressed in the original 1280 × 720 mine. */
  motion?: { left: number; right: number; speed: number; direction?: 1 | -1 };
}

export interface LevelDefinition {
  id: number;
  name: string;
  subtitle: string;
  target: number;
  duration: number;
  ores: OreDefinition[];
  palette: 'ochre' | 'copper' | 'emerald' | 'deep';
}

export const ORE_TYPES: Record<
  OreKind,
  { name: string; value: number; weight: number; radius: number }
> = {
  goldSmall: { name: '小金块', value: 50, weight: 1, radius: 16 },
  goldMedium: { name: '中金块', value: 200, weight: 2.5, radius: 25 },
  goldLarge: { name: '大金块', value: 500, weight: 6, radius: 38 },
  diamond: { name: '钻石', value: 600, weight: 1.2, radius: 15 },
  rockSmall: { name: '小石头', value: 10, weight: 3, radius: 20 },
  rockLarge: { name: '大石头', value: 20, weight: 7, radius: 34 },
  bag: { name: '神秘钱袋', value: 100, weight: 2, radius: 22 },
  barrel: { name: '炸药桶', value: 0, weight: 6, radius: 26 },
  pig: { name: '猪猪', value: 30, weight: 2, radius: 22 },
  diamondPig: { name: '含钻猪猪', value: 630, weight: 2.2, radius: 24 },
  elf: { name: '小精灵矿工', value: 60, weight: 2.5, radius: 23 },
};

export function oreValue(ore: OreDefinition, diamondBonus = false): number {
  if (ore.kind === 'bag') return ore.bagValue ?? ORE_TYPES.bag.value;
  if (ore.kind === 'diamondPig') return ORE_TYPES.pig.value + ORE_TYPES.diamond.value * (diamondBonus ? 1.5 : 1);
  const value = ORE_TYPES[ore.kind].value;
  return ore.kind === 'diamond' && diamondBonus ? Math.round(value * 1.5) : value;
}

// Every position and item is fixed. Retrying a level always restores the same mine.
const POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [416, 330], [864, 330], [568, 450], [712, 450],
  [264, 450], [1016, 450], [112, 330], [1168, 330],
  [568, 580], [712, 580], [416, 580], [864, 580],
  [264, 580], [1016, 580], [568, 330], [712, 330],
  [416, 450], [864, 450], [264, 330], [1016, 330],
  [112, 450], [1168, 450], [112, 580], [1168, 580],
  [640, 655], [640, 390],
];

const SYMBOLS: Record<string, OreKind> = {
  s: 'goldSmall', m: 'goldMedium', L: 'goldLarge', d: 'diamond',
  r: 'rockSmall', R: 'rockLarge', b: 'bag',
};

const BLUEPRINTS = [
  ['初见金光', '先瞄准大金块，慢慢找到节奏。', 500, 'L m s r L s m R s L m r s m'],
  ['浅层矿脉', '金块越重，拉回地面需要越久。', 800, 'm L s R m L r s m L s r m L s'],
  ['蓝色惊喜', '钻石又轻又值钱，值得耐心瞄准。', 1200, 'd m L r s L m R d L s r m L s m'],
  ['石缝寻金', '看看石头后面，藏着什么好东西。', 1500, 'r d L m L R d s L m r d m L s m r'],
  ['神秘口袋', '钱袋里有惊喜，金块依然很可靠。', 1800, 'b L d r m L d R s b L m d r L s m r'],
  ['铜色山丘', '矿层开始变深，别把时间花在石头上。', 2000, 'r d L m L d R b d L m r L d s b m L r'],
  ['双生矿洞', '左右都有宝藏，选好下一次出钩方向。', 2200, 'd R L d m L r b d L m R L d b s L m d r'],
  ['地下回廊', '先收容易够到的，再向深处探索。', 2400, 'L d R d L b r L d m L r d L b m R d L s'],
  ['钻石小径', '沿着蓝色光芒，找到你的通关路线。', 2600, 'r L d R d L b d L m r L d b L R d m L d s'],
  ['黄金十字', '一半旅程已完成，稳住每一次出钩。', 2800, 'd L r d L R b L d m L d r L b d R L m d L s'],
  ['翡翠矿层', '深层宝石更多，也更考验你的取舍。', 3000, 'R d L d b L r d L m L d R L b d L r d L m L s'],
  ['沉睡宝库', '宝藏就在眼前，先为钻石腾出通路。', 3200, 'd R L d L b r L d L m d L R b L d m L d r L s'],
  ['深井回声', '盯住钩尖，拉回来的矿石才算收入。', 3400, 'L d R d L r b d L m L d R L b d L m d L r L d s'],
  ['碎石迷阵', '绕开沉重的岩石，把时间留给宝藏。', 3600, 'R d L d L r d b L d L m R L d b L m d L r L d s'],
  ['满载而归', '每一趟都很珍贵，尽量减少空钩。', 3800, 'd L R d L b r d L d L m R L b d L m d L r L d s'],
  ['幽蓝地心', '更深的矿层里，轻巧的钻石格外划算。', 4000, 'R d L d L r d b L d L m d R L b d L m r d L s L d'],
  ['黄金走廊', '观察前后遮挡，再决定先抓哪一块。', 4250, 'd R L d L b r d L d L m d R L b d L m r d L s L d'],
  ['宝石风暴', '高价值目标很多，节奏同样重要。', 4500, 'R d L d L r d b L d L m d R L b d L m r d L m s L d'],
  ['最后的矿灯', '还差一步，把最有把握的宝藏带回家。', 4750, 'd R L d L r d b L d L m d R L b d L m r d L m s L d'],
  ['传奇矿工', '最后一关：用你的判断，赢下整座矿山。', 5000, 'R d L d L r d b L d L m d R L b d L m r d L m s L d'],
] as const;

const PALETTES: LevelDefinition['palette'][] = ['ochre', 'copper', 'emerald', 'deep'];
const BAG_VALUES = [100, 300, 600] as const;

const ORIGINAL_LEVELS: LevelDefinition[] = BLUEPRINTS.map((blueprint, index) => {
  const [name, subtitle, target, layout] = blueprint;
  const id = index + 1;
  const stage = Math.floor(index / 5);
  const mirror = index % 2 === 1;
  const ores = layout.split(' ').map((symbol, slot): OreDefinition => {
    const kind = SYMBOLS[symbol]!;
    const [baseX, baseY] = POSITIONS[slot]!;
    // Each chapter lowers the upper shelves. The deepest shelf stays in bounds.
    const depth = baseY === 330 ? 18 : baseY === 450 ? 10 : baseY === 580 ? 4 : baseY === 390 ? 14 : 0;
    return {
      id: `level-${id}-ore-${slot + 1}`,
      kind,
      x: mirror ? 1280 - baseX : baseX,
      y: baseY + stage * depth,
      radius: ORE_TYPES[kind].radius,
      ...(kind === 'bag' ? { bagValue: BAG_VALUES[(id + slot) % BAG_VALUES.length] } : {}),
    };
  });
  return { id, name, subtitle, target, duration: 60, ores, palette: PALETTES[stage]! };
});

export const CAMPAIGN_LEVEL_COUNT = 40;
export const MAX_ENDLESS_LEVEL = 1_000_000;

const EXPANSION_BLUEPRINTS = [
  ['危险的木桶', '碰到炸药桶会爆炸，先收走周围想要的宝藏。', 1600],
  ['猪猪散步', '猪猪会来回走动，预判它前进的方向。', 1900],
  ['闪亮的嘴巴', '含钻猪猪的价值等于猪猪加上一颗钻石。', 2200],
  ['忙碌的小矿工', '小精灵会挖掉同一横线上的物件，抓住它就能让它停下。', 2500],
  ['矿洞新伙伴', '金钻在上层，精灵忙着清理下层矿道。', 2800],
  ['追逐蓝光', '让抓钩与含钻猪猪在途中相遇。', 3000],
  ['两端的火药', '两侧木桶要小心，中央矿脉更安全。', 3200],
  ['横行的铲子', '先保护精灵行进路线上的高价宝藏。', 3400],
  ['猪猪快跑', '猪猪的脚步更快了，抓准出钩的时机。', 3600],
  ['热闹的矿场', '上层寻金，下层追逐，挑选自己的路线。', 3800],
  ['铜矿快车', '含钻猪猪轻巧值钱，但不会停下来等你。', 3950],
  ['精灵巡逻', '一条横线来回巡逻，先观察再下钩。', 4100],
  ['桶边的宝藏', '爆炸会波及邻近物件，远处的金钻更稳妥。', 4250],
  ['闪钻牧场', '矿脉和含钻猪猪，选好下一趟收入。', 4400],
  ['铲尖与钩尖', '抓走精灵，可以保住它还没挖到的物件。', 4500],
  ['深层运动会', '移动目标也能抓，记得给回收留够时间。', 4600],
  ['矿道守护者', '先抓移动伙伴，还是先收上层金钻？', 4700],
  ['地心的火花', '认清炸药桶的位置，安排安全的收矿顺序。', 4800],
  ['满矿皆星光', '宝藏足够丰富，把握最有价值的每一钩。', 4900],
  ['新的传奇', '挑战最后的新矿区，再去无尽矿脉继续冒险。', 5000],
] as const;

const SAFE_COLUMNS = [112, 264, 416, 568, 712, 864, 1016, 1168] as const;

interface ExpansionOptions {
  id: number;
  variant: number;
  mechanics: number;
  speed: number;
  random?: () => number;
}

/**
 * The two upper shelves remain outside both the elf's row and every barrel's blast.
 * Only the three lower demonstration prizes can be lost to those hazards.
 */
function expansionOres({ id, variant, mechanics, speed, random }: ExpansionOptions): OreDefinition[] {
  const ores: OreDefinition[] = [];
  const add = (kind: OreKind, x: number, y: number, motion?: OreDefinition['motion'], bagValue?: number) => {
    ores.push({ id: `level-${id}-ore-${ores.length + 1}`, kind, x, y, radius: ORE_TYPES[kind].radius,
      ...(motion ? { motion } : {}), ...(bagValue === undefined ? {} : { bagValue }) });
  };
  for (let row = 0; row < 2; row++) {
    SAFE_COLUMNS.forEach((baseX, column) => {
      const checker = (row + column + variant) % 2;
      let kind: OreKind = checker ? 'diamond' : 'goldLarge';
      // Vary a few treasures without reducing the guaranteed safe value below 8,000.
      if ((column + variant) % 7 === 0 && row === 1) kind = 'diamond';
      const x = baseX + (random ? Math.round(random() * 16 - 8) : 0);
      const y = 330 + row * 100 + (random ? Math.round(random() * 12 - 6) : 0);
      add(kind, x, y);
    });
  }

  add('barrel', variant % 2 ? 112 : 1168, 645);
  if (mechanics >= 2) {
    add('pig', 264, 525, { left: 160, right: 560, speed: 34 * speed, direction: 1 });
  }
  if (mechanics >= 3) {
    add('diamondPig', 1016, 525, { left: 720, right: 1120, speed: 39 * speed, direction: -1 });
  }
  if (mechanics >= 4) {
    add('elf', 640, 590, { left: 264, right: 1016, speed: 46 * speed, direction: variant % 2 ? -1 : 1 });
  }
  if (variant >= 6) add('barrel', variant % 2 ? 1168 : 112, 645);
  if (variant >= 8) add('pig', 568, 525, { left: 416, right: 864, speed: 31 * speed, direction: -1 });
  // These prizes deliberately demonstrate an elf clearing a path and a barrel's reach.
  add(variant % 3 === 0 ? 'diamond' : 'goldMedium', 416, 590);
  add(variant % 3 === 1 ? 'bag' : 'rockSmall', 864, 590, undefined, variant % 3 === 1 ? 300 : undefined);
  add('rockSmall', variant % 2 ? 264 : 1016, 640);
  return ores;
}

const EXPANSION_LEVELS: LevelDefinition[] = EXPANSION_BLUEPRINTS.map(([name, subtitle, target], index) => ({
  id: index + 21, name, subtitle, target, duration: 60,
  ores: expansionOres({ id: index + 21, variant: index, mechanics: Math.min(4, index + 1), speed: 1 + Math.min(index, 15) * 0.025 }),
  palette: PALETTES[Math.floor(index / 5)]!,
}));

export const LEVELS: LevelDefinition[] = [...ORIGINAL_LEVELS, ...EXPANSION_LEVELS];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** A bounded 25-item mine: high round numbers never create a denser, impossible grid. */
export function generateEndlessLevel(index: number, seed: number): LevelDefinition {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_ENDLESS_LEVEL) {
    throw new RangeError(`Endless level index must be between 0 and ${MAX_ENDLESS_LEVEL - 1}`);
  }
  if (!Number.isFinite(seed)) throw new RangeError('Endless seed must be finite');
  const random = seededRandom((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b1));
  const variant = Math.floor(random() * EXPANSION_BLUEPRINTS.length);
  const id = index + 1;
  const target = Math.min(4800, 1000 + Math.floor((Math.log2(index + 1) * 300 + Math.min(index, 100) * 22) / 50) * 50);
  return {
    id, name: `无尽矿脉 ${id}`, subtitle: '矿脉每轮变化。桶会爆炸，猪猪会跑，小精灵会清理自己的横线。',
    target, duration: 60, palette: PALETTES[Math.floor(random() * PALETTES.length)]!,
    ores: expansionOres({ id, variant, mechanics: 4, speed: 1 + Math.min(index, 40) * 0.02, random }),
  };
}

export function getLevel(index: number, endless = false, seed = 1): LevelDefinition {
  if (endless) return generateEndlessLevel(index, seed);
  if (!Number.isInteger(index) || index < 0 || index >= LEVELS.length) {
    throw new RangeError(`Campaign level index must be between 0 and ${LEVELS.length - 1}`);
  }
  return LEVELS[index]!;
}

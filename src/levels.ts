export type OreKind =
  | 'goldSmall'
  | 'goldMedium'
  | 'goldLarge'
  | 'diamond'
  | 'rockSmall'
  | 'rockLarge'
  | 'bag';

export interface OreDefinition {
  id: string;
  kind: OreKind;
  x: number;
  y: number;
  radius: number;
  bagValue?: number;
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
};

export function oreValue(ore: OreDefinition, diamondBonus = false): number {
  if (ore.kind === 'bag') return ore.bagValue ?? ORE_TYPES.bag.value;
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

export const LEVELS: LevelDefinition[] = BLUEPRINTS.map((blueprint, index) => {
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

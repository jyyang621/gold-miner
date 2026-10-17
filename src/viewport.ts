export interface MineViewport { width: number; height: number; portrait: boolean }

export const WIDE_VIEWPORT: MineViewport = { width: 1280, height: 720, portrait: false };

export function mineScale(view: MineViewport) {
  return {
    // Leave the large nuggets intact and keep neighbouring shelves apart.
    x: view.portrait ? (view.width - 96) / (1280 - 110) : view.width / 1280,
    y: (view.height - 178) / (720 - 178),
  };
}

export function mineGeometry(view: MineViewport) {
  const scale = mineScale(view);
  return {
    pivotX: view.width / 2,
    pivotY: 148,
    minRope: 38,
    maxRope: view.portrait ? Math.max(760, Math.hypot(view.width / 2 - 28, view.height - 178)) : 760,
    maxAngle: Math.PI * (view.portrait ? 65 : 75) / 180,
    speedScale: Math.max(1, scale.y),
    bounds: { left: 28, right: view.width - 28, bottom: view.height - 30 },
  };
}

export type MineGeometry = ReturnType<typeof mineGeometry>;

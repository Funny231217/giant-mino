import { BOARD_WIDTH, PIECE_TYPES, type ActivePiece, type Cell, type PieceType, type Rotation } from './types';

/** 新規ミノの最上段を置く内部行（非表示バッファ最下2行の上側）。スポーン直後に1段落下を試みる。 */
export const SPAWN_TOP_ROW = 18;

/** SRS の初期姿勢（ボックス左上原点、Y下向き）。 */
const BASE_SHAPES: Record<PieceType, { size: number; cells: Array<[number, number]> }> = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { size: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

function sortCells(cells: Cell[]): Cell[] {
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** ボックス内で時計回り90度回転: (x, y) -> (size-1-y, x) */
function rotateCW(cells: readonly Cell[], size: number): Cell[] {
  return sortCells(cells.map(({ x, y }) => ({ x: size - 1 - y, y: x })));
}

/** 各セルを 2×2 に展開する（GIANT 化）。4セル→16セル。 */
export function expandGiant(cells: readonly Cell[]): Cell[] {
  const out: Cell[] = [];
  for (const { x, y } of cells) {
    out.push({ x: 2 * x, y: 2 * y }, { x: 2 * x + 1, y: 2 * y }, { x: 2 * x, y: 2 * y + 1 }, { x: 2 * x + 1, y: 2 * y + 1 });
  }
  return sortCells(out);
}

type ShapeSet = [normal: Cell[][], giant: Cell[][]];

const SHAPES: Record<PieceType, ShapeSet> = (() => {
  const table = {} as Record<PieceType, ShapeSet>;
  for (const type of PIECE_TYPES) {
    const { size, cells } = BASE_SHAPES[type];
    const normal: Cell[][] = [sortCells(cells.map(([x, y]) => ({ x, y })))];
    for (let r = 1; r < 4; r++) normal.push(rotateCW(normal[r - 1], size));
    // GIANT の各姿勢は「通常ミノの回転後形状」を 2×2 展開して作る
    table[type] = [normal, normal.map(expandGiant)];
  }
  return table;
})();

export function getShape(type: PieceType, isGiant: boolean, rot: Rotation): readonly Cell[] {
  return SHAPES[type][isGiant ? 1 : 0][rot];
}

export function boxSize(type: PieceType, isGiant: boolean): number {
  return BASE_SHAPES[type].size * (isGiant ? 2 : 1);
}

export function pieceCells(a: ActivePiece): Cell[] {
  return getShape(a.piece.type, a.piece.isGiant, a.rot).map((c) => ({ x: c.x + a.x, y: c.y + a.y }));
}

export function shapeBounds(cells: readonly Cell[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of cells) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/** 初期姿勢で水平中央、最上段が SPAWN_TOP_ROW に来る位置。 */
export function spawnPosition(type: PieceType, isGiant: boolean): { x: number; y: number } {
  const b = shapeBounds(getShape(type, isGiant, 0));
  const width = b.maxX - b.minX + 1;
  return { x: Math.floor((BOARD_WIDTH - width) / 2) - b.minX, y: SPAWN_TOP_ROW - b.minY };
}

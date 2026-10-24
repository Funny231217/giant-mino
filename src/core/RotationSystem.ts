import type { Board } from './Board';
import { collides } from './CollisionSystem';
import { getShape } from './Piece';
import type { ActivePiece, PieceType, RotateDir, Rotation } from './types';

export type Kick = readonly [dx: number, dy: number];

/*
 * SRS キックテーブル。tetris.wiki の表記（Y上向き正）のまま記述し、
 * 内部座標（Y下向き正）へは toYDown で dy の符号を反転する。
 * キー "a>b" は姿勢 a から b への遷移（0, 1=R, 2, 3=L）。
 */
const JLSTZ_KICKS_YUP: Record<string, Kick[]> = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

const I_KICKS_YUP: Record<string, Kick[]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

function toYDown(table: Record<string, Kick[]>): Record<string, Kick[]> {
  const out: Record<string, Kick[]> = {};
  for (const [key, kicks] of Object.entries(table)) out[key] = kicks.map(([dx, dy]) => [dx, dy === 0 ? 0 : -dy] as const);
  return out;
}

export const SRS_JLSTZ_KICKS = toYDown(JLSTZ_KICKS_YUP);
export const SRS_I_KICKS = toYDown(I_KICKS_YUP);
const NO_KICK: Kick[] = [[0, 0]];

/**
 * GIANT 専用キック（盤面セル単位、Y下向き正）。仕様書の探索順に、
 * 斜め上2段の候補を末尾に追加している。下方向・無制限の上昇候補は持たない。
 */
export const GIANT_KICKS: Kick[] = [
  [0, 0],
  [-1, 0], [1, 0],
  [-2, 0], [2, 0],
  [0, -1], [0, -2],
  [-1, -1], [1, -1],
  [-2, -1], [2, -1],
  [-1, -2], [1, -2], [-2, -2], [2, -2],
];

/**
 * GIANT I 専用キック。8×2 ⇔ 2×8 の変形は中心からのずれが最大4セルあるため、
 * 横 ±4・上 4 までを「横優先→上方向」の決定的な順序で探索する。
 */
export const GIANT_I_KICKS: Kick[] = (() => {
  const out: Kick[] = [];
  for (const dy of [0, -1, -2, -3, -4]) {
    for (const dx of [0, -1, 1, -2, 2, -3, 3, -4, 4]) out.push([dx, dy]);
  }
  return out;
})();

export function rotateIndex(rot: Rotation, dir: RotateDir): Rotation {
  return (((rot + dir) % 4) + 4) % 4 as Rotation;
}

export function getKicks(type: PieceType, isGiant: boolean, from: Rotation, to: Rotation): readonly Kick[] {
  if (type === 'O') return NO_KICK;
  if (isGiant) return type === 'I' ? GIANT_I_KICKS : GIANT_KICKS;
  return (type === 'I' ? SRS_I_KICKS : SRS_JLSTZ_KICKS)[`${from}>${to}`];
}

export interface RotationResult {
  piece: ActivePiece;
  /** 採用したキック候補の番号（0始まり）。SRS の 5 番目 = 4。 */
  kickIndex: number;
}

/** キック候補を規定順に試し、最初に衝突しない位置を返す。全滅なら null。 */
export function tryRotate(board: Board, a: ActivePiece, dir: RotateDir): RotationResult | null {
  const to = rotateIndex(a.rot, dir);
  const shape = getShape(a.piece.type, a.piece.isGiant, to);
  const kicks = getKicks(a.piece.type, a.piece.isGiant, a.rot, to);
  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy] = kicks[i];
    if (!collides(board, shape, a.x + dx, a.y + dy)) {
      return { piece: { piece: a.piece, rot: to, x: a.x + dx, y: a.y + dy }, kickIndex: i };
    }
  }
  return null;
}

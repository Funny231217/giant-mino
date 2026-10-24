import type { Board } from './Board';
import { getShape } from './Piece';
import type { ActivePiece, Cell } from './types';

export function collides(board: Board, shape: readonly Cell[], ox: number, oy: number): boolean {
  for (const c of shape) {
    if (board.isOccupied(c.x + ox, c.y + oy)) return true;
  }
  return false;
}

export function fits(board: Board, a: ActivePiece, dx = 0, dy = 0): boolean {
  return !collides(board, getShape(a.piece.type, a.piece.isGiant, a.rot), a.x + dx, a.y + dy);
}

/** 現在位置から何段落とせるか（ゴースト・ハードドロップ用）。 */
export function dropDistance(board: Board, a: ActivePiece): number {
  const shape = getShape(a.piece.type, a.piece.isGiant, a.rot);
  let d = 0;
  while (!collides(board, shape, a.x, a.y + d + 1)) d++;
  return d;
}

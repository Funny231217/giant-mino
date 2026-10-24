export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export const PIECE_TYPES: readonly PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

/** 0 = spawn, 1 = R (CW), 2 = 180, 3 = L (CCW) */
export type Rotation = 0 | 1 | 2 | 3;
export type RotateDir = 1 | -1;

export interface Cell {
  x: number;
  y: number;
}

/** 供給順で確定したミノの同一性。HOLDを経由しても変わらない。 */
export interface PieceInstance {
  readonly seq: number;
  readonly type: PieceType;
  readonly isGiant: boolean;
}

/** 盤面上で操作中のミノ。x, y はバウンディングボックス左上（Y軸は下向き）。 */
export interface ActivePiece {
  piece: PieceInstance;
  rot: Rotation;
  x: number;
  y: number;
}

export type SpinType = 'none' | 'mini' | 'full';

export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 40;
export const VISIBLE_HEIGHT = 20;
/** 内部行 0..19 は非表示バッファ。20..39 が表示領域。 */
export const HIDDEN_ROWS = BOARD_HEIGHT - VISIBLE_HEIGHT;

export type GameState = 'idle' | 'playing' | 'paused' | 'over';

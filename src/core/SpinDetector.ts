import type { Board } from './Board';
import type { ActivePiece, SpinType } from './types';

export interface RotationRecord {
  kickIndex: number;
}

/** 姿勢ごとの前方角（T の凸側）。インデックスは CORNER_OFFSETS を参照。 */
const CORNER_OFFSETS = [
  [-1, -1], // 0: 左上
  [1, -1], // 1: 右上
  [1, 1], // 2: 右下
  [-1, 1], // 3: 左下
] as const;
const FRONT_CORNERS: Record<number, [number, number]> = {
  0: [0, 1], // 上向き
  1: [1, 2], // 右向き
  2: [2, 3], // 下向き
  3: [3, 0], // 左向き
};

/**
 * 通常サイズ T ミノの T-Spin 判定（3-corner rule）。
 * ライン消去前の盤面で呼ぶこと。最後の操作が成功した回転でなければ 'none'。
 * - 4角のうち3つ以上が埋まっていなければ 'none'
 * - 前方2角が両方埋まっていれば 'full'
 * - そうでなければ 'mini'。ただし SRS の5番目のキック（index 4）で入った場合は 'full' に格上げ
 * GIANT T は形状が異なるため対象外。
 */
export function detectTSpin(board: Board, a: ActivePiece, lastRotation: RotationRecord | null): SpinType {
  if (a.piece.type !== 'T' || a.piece.isGiant || !lastRotation) return 'none';
  const cx = a.x + 1;
  const cy = a.y + 1;
  const filled = CORNER_OFFSETS.map(([dx, dy]) => board.isOccupied(cx + dx, cy + dy));
  const count = filled.filter(Boolean).length;
  if (count < 3) return 'none';
  const [f1, f2] = FRONT_CORNERS[a.rot];
  if (filled[f1] && filled[f2]) return 'full';
  return lastRotation.kickIndex === 4 ? 'full' : 'mini';
}

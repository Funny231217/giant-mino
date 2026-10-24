import { GameEngine, LINE_CLEAR_DELAY_MS } from '../core/GameEngine';
import type { Cell, PieceInstance, PieceType } from '../core/types';

export function inst(type: PieceType, isGiant = false, seq = 999): PieceInstance {
  return { seq, type, isGiant };
}

/** MAX_STEP_MS の制限を受けないよう細かく刻んで時間を進める。 */
export function advance(engine: GameEngine, ms: number, step = 10): void {
  let left = ms;
  while (left > 0) {
    const d = Math.min(step, left);
    engine.update(d);
    left -= d;
  }
}

/** セル集合をバウンディングボックス内の文字列に描く（'#' = 占有）。 */
export function renderCells(cells: readonly Cell[]): string[] {
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  const maxX = Math.max(...cells.map((c) => c.x));
  const maxY = Math.max(...cells.map((c) => c.y));
  const rows: string[] = [];
  for (let y = minY; y <= maxY; y++) {
    let s = '';
    for (let x = minX; x <= maxX; x++) s += cells.some((c) => c.x === x && c.y === y) ? '#' : '.';
    rows.push(s);
  }
  return rows;
}

export function cellKey(c: Cell): string {
  return `${c.x},${c.y}`;
}

/** 次の固定で起きるイベントを収集する。 */
export function collect(engine: GameEngine) {
  const events: Parameters<Parameters<GameEngine['on']>[0]>[0][] = [];
  engine.on((e) => events.push(e));
  return events;
}

/** ライン消去の発光を終わらせる（消去・得点確定・次のミノ出現まで進める） */
export function finishClear(engine: GameEngine): void {
  advance(engine, LINE_CLEAR_DELAY_MS);
}

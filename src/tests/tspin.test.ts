import { describe, expect, it } from 'vitest';
import { Board } from '../core/Board';
import { GameEngine } from '../core/GameEngine';
import { detectTSpin } from '../core/SpinDetector';
import { collect, finishClear, inst } from './helpers';

function lastAction(events: ReturnType<typeof collect>) {
  const a = [...events].reverse().find((e) => e.type === 'action');
  return a && a.type === 'action' ? a : null;
}

/** 列3の上に屋根、行38は列3-5が空、行39は列4だけ空 → T-Spin Double 形 */
const TSD_BOARD = [
  '...#......',
  '###...####',
  '####.#####',
];

describe('10/11. T-Spin 判定（通常 T）', () => {
  it('T-Spin Double: R→2 回転で穴に入れて固定', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.start();
    engine.board = Board.fromStrings(TSD_BOARD);
    const events = collect(engine);
    engine.debugSetActive(inst('T'), 1, 3, 37);
    expect(engine.rotate(1)).toBe(true);
    expect(engine.active!.rot).toBe(2);
    engine.hardDrop();
    finishClear(engine);
    const a = lastAction(events)!;
    expect(a.spin).toBe('full');
    expect(a.rows).toHaveLength(2);
    expect(a.result.label).toBe('T-SPIN DOUBLE');
    expect(a.result.basePoints).toBe(1200);
    expect(engine.b2b).toBe(true);
  });

  it('T-Spin Single: 1行だけ揃う形', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.start();
    engine.board = Board.fromStrings(['...#......', '..........', '####.#####']);
    const events = collect(engine);
    engine.debugSetActive(inst('T'), 1, 3, 37);
    engine.rotate(1);
    engine.hardDrop();
    finishClear(engine);
    const a = lastAction(events)!;
    expect(a.spin).toBe('full');
    expect(a.result.label).toBe('T-SPIN SINGLE');
    expect(a.result.basePoints).toBe(800);
  });

  it('T-Spin Mini Single: 後方2角+前方1角', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.start();
    // T 上向き(0) 中心 (4,38)。前方角 (3,37)のみ埋まり、後方角 (3,39)(5,39) 埋まり
    engine.board = Board.fromStrings(['...#......', '###...####', '####.#####']);
    const events = collect(engine);
    engine.debugSetActive(inst('T'), 3, 3, 37); // L 状態: (4,37)(3,38)(4,38)(4,39)
    expect(engine.rotate(1)).toBe(true); // L→0, kick 0
    expect(engine.active!.rot).toBe(0);
    expect([engine.active!.x, engine.active!.y]).toEqual([3, 37]);
    engine.hardDrop();
    finishClear(engine);
    const a = lastAction(events)!;
    expect(a.spin).toBe('mini');
    expect(a.result.label).toBe('T-SPIN MINI SINGLE');
    expect(a.result.basePoints).toBe(200);
  });

  it('11. 回転せずに同じ位置へ置いた T は T-Spin にならない', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.start();
    engine.board = Board.fromStrings(TSD_BOARD);
    const events = collect(engine);
    engine.debugSetActive(inst('T'), 2, 3, 37);
    engine.hardDrop();
    finishClear(engine);
    const a = lastAction(events)!;
    expect(a.spin).toBe('none');
    expect(a.result.label).toBe('DOUBLE');
  });

  it('11. 回転後に移動したら T-Spin にならない', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.start();
    engine.board = new Board();
    engine.debugSetActive(inst('T'), 0, 3, 30);
    engine.rotate(1);
    engine.shift(1);
    expect(engine.lastRotation).toBeNull();
  });

  it('角が2つ以下なら回転直後でも T-Spin ではない', () => {
    const board = Board.fromStrings(['..........', '####.#####']);
    const spin = detectTSpin(board, { piece: inst('T'), rot: 2, x: 3, y: 37 }, { kickIndex: 0 });
    expect(spin).toBe('none');
  });

  it('5番目のキックで入った Mini 形状は通常 T-Spin に格上げ', () => {
    // 後方2角+前方1角でも kickIndex 4 なら full
    const board = Board.fromStrings(['...#......', '..........', '####.#####']);
    const a = { piece: inst('T'), rot: 0 as const, x: 3, y: 37 };
    expect(detectTSpin(board, a, { kickIndex: 0 })).toBe('mini');
    expect(detectTSpin(board, a, { kickIndex: 4 })).toBe('full');
  });

  it('T-Spin（0ライン）も action イベントとスコアが出る', () => {
    const engine = new GameEngine({ seed: 1 });
    engine.start();
    engine.board = Board.fromStrings(['...#......', '##.....###', '####.####.']);
    const events = collect(engine);
    engine.debugSetActive(inst('T'), 1, 3, 37);
    engine.rotate(1);
    engine.hardDrop();
    finishClear(engine);
    const a = lastAction(events)!;
    expect(a.spin).toBe('full');
    expect(a.rows).toHaveLength(0);
    expect(a.result.label).toBe('T-SPIN');
    expect(a.result.basePoints).toBe(400);
  });

  it('12. GIANT T は T-Spin 判定の対象外', () => {
    const board = new Board();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 10; x++) board.set(x, y, 1);
    const spin = detectTSpin(board, { piece: inst('T', true), rot: 2, x: 2, y: 30 }, { kickIndex: 0 });
    expect(spin).toBe('none');
  });
});

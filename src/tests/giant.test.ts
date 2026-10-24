import { describe, expect, it } from 'vitest';
import { Board } from '../core/Board';
import { collides, dropDistance, fits } from '../core/CollisionSystem';
import { GameEngine } from '../core/GameEngine';
import { getShape, pieceCells, shapeBounds } from '../core/Piece';
import { mulberry32 } from '../core/PieceGenerator';
import { tryRotate } from '../core/RotationSystem';
import { PIECE_TYPES, type ActivePiece, type Rotation } from '../core/types';
import { advance, cellKey, collect, inst, renderCells } from './helpers';

const ROTS: Rotation[] = [0, 1, 2, 3];

describe('GIANT MINO 形状', () => {
  it('4. 全7種類・全姿勢で16個の重複しない整数セルを占有する', () => {
    for (const type of PIECE_TYPES) {
      for (const rot of ROTS) {
        const cells = getShape(type, true, rot);
        expect(cells).toHaveLength(16);
        expect(new Set(cells.map(cellKey)).size).toBe(16);
        for (const c of cells) {
          expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true);
        }
      }
      // 通常ミノは4セルのまま
      expect(getShape(type, false, 0)).toHaveLength(4);
    }
  });

  it('5. GIANT T は ..##.. / ..##.. / ###### / ######', () => {
    expect(renderCells(getShape('T', true, 0))).toEqual(['..##..', '..##..', '######', '######']);
  });

  it('6. GIANT I は水平 8×2、GIANT O は 4×4', () => {
    expect(renderCells(getShape('I', true, 0))).toEqual(['########', '########']);
    const vertical = shapeBounds(getShape('I', true, 1));
    expect([vertical.maxX - vertical.minX + 1, vertical.maxY - vertical.minY + 1]).toEqual([2, 8]);
    expect(renderCells(getShape('O', true, 0))).toEqual(['####', '####', '####', '####']);
  });

  it('各姿勢は通常ミノの回転後形状を 2×2 展開したもの', () => {
    for (const type of PIECE_TYPES) {
      for (const rot of ROTS) {
        const expected = getShape(type, false, rot)
          .flatMap(({ x, y }) => [
            [2 * x, 2 * y],
            [2 * x + 1, 2 * y],
            [2 * x, 2 * y + 1],
            [2 * x + 1, 2 * y + 1],
          ])
          .map(([x, y]) => `${x},${y}`)
          .sort();
        expect(getShape(type, true, rot).map(cellKey).sort()).toEqual(expected);
      }
    }
  });

  it('7. 90度回転4回で元の16セル形状・位置に戻る（時計・反時計とも）', () => {
    const board = new Board();
    for (const type of PIECE_TYPES) {
      for (const dir of [1, -1] as const) {
        let a: ActivePiece = { piece: inst(type, true), rot: 0, x: 1, y: 22 };
        const before = pieceCells(a).map(cellKey).sort();
        for (let i = 0; i < 4; i++) {
          const r = tryRotate(board, a, dir);
          expect(r).not.toBeNull();
          a = r!.piece;
          expect(pieceCells(a)).toHaveLength(16);
        }
        expect(a.rot).toBe(0);
        expect(pieceCells(a).map(cellKey).sort()).toEqual(before);
      }
    }
  });
});

describe('GIANT 回転・衝突', () => {
  it('8. 周囲が埋まっていると回転しない（状態は変わらない）', () => {
    for (const type of PIECE_TYPES.filter((t) => t !== 'O')) {
      const a: ActivePiece = { piece: inst(type, true), rot: 0, x: 1, y: 24 };
      const board = new Board();
      const own = new Set(pieceCells(a).map(cellKey));
      for (let y = 0; y < board.height; y++)
        for (let x = 0; x < board.width; x++) if (!own.has(`${x},${y}`)) board.set(x, y, 1);
      expect(tryRotate(board, a, 1)).toBeNull();
      expect(tryRotate(board, a, -1)).toBeNull();
    }
  });

  it('8. ランダム盤面でも回転結果が場外・既存ブロックと重ならない', () => {
    const rng = mulberry32(2024);
    let rotations = 0;
    for (let trial = 0; trial < 3000; trial++) {
      const board = new Board();
      for (let y = 20; y < 40; y++)
        for (let x = 0; x < 10; x++) if (rng() < 0.3) board.set(x, y, 1);
      const type = PIECE_TYPES[Math.floor(rng() * 7)];
      const a: ActivePiece = {
        piece: inst(type, true),
        rot: Math.floor(rng() * 4) as Rotation,
        x: Math.floor(rng() * 12) - 2,
        y: 14 + Math.floor(rng() * 24),
      };
      if (!fits(board, a)) continue;
      const r = tryRotate(board, a, rng() < 0.5 ? 1 : -1);
      if (!r) continue;
      rotations++;
      for (const c of pieceCells(r.piece)) {
        expect(board.inBounds(c.x, c.y)).toBe(true);
        expect(board.get(c.x, c.y)).toBe(0);
      }
      // 上昇は最大4段（GIANT I）まで
      expect(a.y - r.piece.y).toBeLessThanOrEqual(4);
    }
    expect(rotations).toBeGreaterThan(100);
  });

  it('GIANT T は壁際でもキックで回転できる', () => {
    const board = new Board();
    // 右向き(R)で左壁に接した GIANT T → 0 へ戻すには右へ 2 キックが必要
    const a: ActivePiece = { piece: inst('T', true), rot: 1, x: -2, y: 24 };
    expect(fits(board, a)).toBe(true);
    const r = tryRotate(board, a, -1)!;
    expect(r.piece.rot).toBe(0);
    expect(r.piece.x).toBe(0);
  });

  it('GIANT I は床に置いた水平状態から縦に回転できる', () => {
    const board = new Board();
    const a: ActivePiece = { piece: inst('I', true), rot: 0, x: 1, y: 36 }; // 行 38,39
    expect(dropDistance(board, a)).toBe(0);
    const r = tryRotate(board, a, 1)!;
    expect(r).not.toBeNull();
    expect(Math.max(...pieceCells(r.piece).map((c) => c.y))).toBe(39);
  });

  it('16. ゴーストは GIANT 形状でも正しい到達位置を計算する', () => {
    const board = new Board();
    const a: ActivePiece = { piece: inst('T', true), rot: 0, x: 2, y: 18 };
    expect(a.y + dropDistance(board, a)).toBe(36); // 行 36..39
    board.set(4, 30, 1); // 突起の真下ではなく土台の列4 に障害物
    expect(a.y + dropDistance(board, a)).toBe(26); // 土台最下段 (y+3) = 29
    // 突起(列4-5)の下だけに障害物がある場合
    const b2 = new Board();
    b2.set(7, 33, 1);
    const ghostY = a.y + dropDistance(b2, a);
    expect(collides(b2, getShape('T', true, 0), a.x, ghostY)).toBe(false);
    expect(collides(b2, getShape('T', true, 0), a.x, ghostY + 1)).toBe(true);
    expect(ghostY).toBe(29);
  });
});

describe('GIANT とゲーム進行', () => {
  it('供給10個ごとにちょうど1個 GIANT が出現し、spawn イベントと一致する', () => {
    const engine = new GameEngine({ seed: 5 });
    const events = collect(engine);
    engine.start();
    for (let i = 0; i < 39; i++) {
      engine.hardDrop();
      engine.board.clear();
    }
    const spawned = [
      { seq: 1, isGiant: false },
      ...events.filter((e) => e.type === 'spawn').map((e) => (e.type === 'spawn' ? e.piece : null)!),
    ];
    const giants = spawned.filter((p) => p.isGiant).map((p) => p.seq);
    expect(giants).toEqual([10, 20, 30, 40]);
  });

  it('GIANT のスポーンは横幅内に収まり、移動・設置できる', () => {
    const engine = new GameEngine({ seed: 11 });
    engine.start();
    for (let i = 0; i < 9; i++) {
      engine.hardDrop();
      engine.board.clear();
    }
    const a = engine.active!;
    expect(a.piece.isGiant).toBe(true);
    const cells = pieceCells(a);
    expect(cells.every((c) => c.x >= 0 && c.x < 10)).toBe(true);
    while (engine.shift(-1));
    expect(Math.min(...pieceCells(engine.active!).map((c) => c.x))).toBe(0);
    engine.rotate(1);
    advance(engine, 50);
    engine.hardDrop();
    const filled = engine.board.cells.flat().filter((v) => v !== 0).length;
    expect(filled === 16 || engine.lines > 0).toBe(true);
  });
});

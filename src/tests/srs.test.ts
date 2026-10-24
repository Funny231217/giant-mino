import { describe, expect, it } from 'vitest';
import { Board } from '../core/Board';
import { fits } from '../core/CollisionSystem';
import { getShape, pieceCells, spawnPosition } from '../core/Piece';
import { SRS_I_KICKS, SRS_JLSTZ_KICKS, getKicks, tryRotate } from '../core/RotationSystem';
import type { ActivePiece, Rotation } from '../core/types';
import { inst, renderCells } from './helpers';

describe('通常ミノ形状・スポーン', () => {
  it('SRS 姿勢 (T の 0/R/2/L)', () => {
    expect(renderCells(getShape('T', false, 0))).toEqual(['.#.', '###']);
    expect(renderCells(getShape('T', false, 1))).toEqual(['#.', '##', '#.']);
    expect(renderCells(getShape('T', false, 2))).toEqual(['###', '.#.']);
    expect(renderCells(getShape('T', false, 3))).toEqual(['.#', '##', '.#']);
  });

  it('I の R 状態は 4×4 ボックスの列2', () => {
    expect(getShape('I', false, 1).map((c) => c.x)).toEqual([2, 2, 2, 2]);
    expect(getShape('I', false, 2).map((c) => c.y)).toEqual([2, 2, 2, 2]);
  });

  it('スポーン位置: JLSTZ と I は列3から、O は列4から', () => {
    expect(spawnPosition('T', false)).toEqual({ x: 3, y: 18 });
    expect(spawnPosition('I', false)).toEqual({ x: 3, y: 17 });
    expect(spawnPosition('O', false)).toEqual({ x: 4, y: 18 });
  });

  it('キックテーブルは Y下向き座標に変換されている', () => {
    // wiki: 0->R = (0,0) (-1,0) (-1,+1) (0,-2) (-1,-2)  [Y上向き]
    expect(SRS_JLSTZ_KICKS['0>1']).toEqual([[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]);
    // wiki: I 0->R = (0,0) (-2,0) (+1,0) (-2,-1) (+1,+2)
    expect(SRS_I_KICKS['0>1']).toEqual([[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]]);
  });
});

describe('9. SRS 回転と壁蹴り・床蹴り', () => {
  it('空中では kick 0 で回転、O は回転しても位置不変', () => {
    const board = new Board();
    const t: ActivePiece = { piece: inst('T'), rot: 0, x: 3, y: 20 };
    const r = tryRotate(board, t, 1)!;
    expect([r.piece.rot, r.piece.x, r.piece.y, r.kickIndex]).toEqual([1, 3, 20, 0]);
    const o: ActivePiece = { piece: inst('O'), rot: 0, x: 4, y: 20 };
    const ro = tryRotate(board, o, 1)!;
    expect(pieceCells(ro.piece)).toEqual(pieceCells(o));
  });

  it('T: 左壁で R→2 は右に1キック', () => {
    const board = new Board();
    const t: ActivePiece = { piece: inst('T'), rot: 1, x: -1, y: 20 };
    expect(fits(board, t)).toBe(true);
    const r = tryRotate(board, t, 1)!;
    expect([r.piece.rot, r.piece.x, r.piece.y, r.kickIndex]).toEqual([2, 0, 20, 1]);
  });

  it('T: 床で 0→R は (-1,-1) キック（床蹴り）', () => {
    const board = new Board();
    const t: ActivePiece = { piece: inst('T'), rot: 0, x: 3, y: 38 };
    const r = tryRotate(board, t, 1)!;
    expect([r.piece.rot, r.piece.x, r.piece.y, r.kickIndex]).toEqual([1, 2, 37, 2]);
  });

  it('I: 左壁の縦 (R) から 2 へは右に2キック', () => {
    const board = new Board();
    const i: ActivePiece = { piece: inst('I'), rot: 1, x: -2, y: 20 };
    expect(fits(board, i)).toBe(true);
    const r = tryRotate(board, i, 1)!;
    expect([r.piece.rot, r.piece.x, r.piece.y, r.kickIndex]).toEqual([2, 0, 20, 2]);
  });

  it('I: 右壁の縦 (L) から 0 へは I 専用テーブルで左に2キック', () => {
    const board = new Board();
    const i: ActivePiece = { piece: inst('I'), rot: 3, x: 8, y: 20 }; // 列9
    expect(fits(board, i)).toBe(true);
    const r = tryRotate(board, i, 1)!;
    // 3>0: (0,0) (+1,0) (-2,0) ... → (-2,0) が最初に成功
    expect([r.piece.rot, r.piece.x, r.kickIndex]).toEqual([0, 6, 2]);
  });

  it('全候補が衝突なら回転失敗', () => {
    // 狭い縦穴に I を縦で入れてあり、横にはできない
    const board2 = new Board();
    for (let y = 20; y < 40; y++) for (let x = 0; x < 10; x++) if (x !== 4) board2.set(x, y, 1);
    const i: ActivePiece = { piece: inst('I'), rot: 1, x: 2, y: 36 };
    expect(fits(board2, i)).toBe(true);
    expect(tryRotate(board2, i, 1)).toBeNull();
    expect(tryRotate(board2, i, -1)).toBeNull();
  });

  it('5番目のキック (index 4) まで規定順に探索する', () => {
    for (const [type, from, dir] of [['T', 0, 1], ['T', 2, -1], ['L', 1, 1], ['I', 0, 1], ['I', 3, -1]] as const) {
      const a: ActivePiece = { piece: inst(type), rot: from, x: 3, y: 30 };
      const to = ((from + dir + 4) % 4) as Rotation;
      const kicks = getKicks(type, false, from, to);
      const own = new Set(pieceCells(a).map((c) => `${c.x},${c.y}`));
      const target = (i: number) =>
        getShape(type, false, to).map((c) => `${c.x + a.x + kicks[i][0]},${c.y + a.y + kicks[i][1]}`);
      const last = new Set(target(4));
      const board = new Board();
      // 候補 0..3 をそれぞれ1セルずつ塞ぐ（現在位置・候補4とは重ならないセル）
      for (let i = 0; i < 4; i++) {
        const block = target(i).find((k) => !own.has(k) && !last.has(k))!;
        const [x, y] = block.split(',').map(Number);
        board.set(x, y, 1);
      }
      const r = tryRotate(board, a, dir)!;
      expect(r).not.toBeNull();
      expect(r.kickIndex).toBe(4);
      expect([r.piece.x, r.piece.y]).toEqual([a.x + kicks[4][0], a.y + kicks[4][1]]);
    }
  });
});

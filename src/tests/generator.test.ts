import { describe, expect, it } from 'vitest';
import { MIN_SAME_PIECE_DISTANCE, PieceGenerator, mulberry32 } from '../core/PieceGenerator';
import { PIECE_TYPES } from '../core/types';

describe('PieceGenerator (7-bag + GIANT 通し番号)', () => {
  it('1. 各バッグは7種類を1回ずつ供給する', () => {
    const gen = new PieceGenerator(mulberry32(42));
    for (let bag = 0; bag < 20; bag++) {
      const types = Array.from({ length: 7 }, () => gen.next().type).sort();
      expect(types).toEqual([...PIECE_TYPES].sort());
    }
  });

  it('同じ種類のミノは連続せず、最低 MIN_SAME_PIECE_DISTANCE の間隔があく（バッグ境界を含む）', () => {
    expect(MIN_SAME_PIECE_DISTANCE).toBe(4);
    for (let seed = 1; seed <= 200; seed++) {
      const gen = new PieceGenerator(mulberry32(seed));
      const lastSeen = new Map<string, number>();
      for (let i = 1; i <= 700; i++) {
        const p = gen.next();
        const prev = lastSeen.get(p.type);
        if (prev !== undefined) expect(i - prev).toBeGreaterThanOrEqual(MIN_SAME_PIECE_DISTANCE);
        lastSeen.set(p.type, i);
      }
    }
  });

  it('間隔制約を付けても 7-bag と並びのランダム性は保たれる', () => {
    const gen = new PieceGenerator(mulberry32(99));
    const firstOfBag = new Set<string>();
    for (let bag = 0; bag < 300; bag++) {
      const types = Array.from({ length: 7 }, () => gen.next().type);
      expect([...types].sort()).toEqual([...PIECE_TYPES].sort());
      firstOfBag.add(types[0]);
    }
    expect(firstOfBag.size).toBe(7); // どの種類もバッグ先頭に来うる
  });

  it('間隔 1 を指定すると素の 7-bag（連続あり）になる', () => {
    let repeats = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const gen = new PieceGenerator(mulberry32(seed), 1);
      let prev = '';
      for (let i = 0; i < 70; i++) {
        const t = gen.next().type;
        if (t === prev) repeats++;
        prev = t;
      }
    }
    expect(repeats).toBeGreaterThan(0);
  });

  it('2. 10番目・20番目・30番目…のみ GIANT', () => {
    const gen = new PieceGenerator(mulberry32(1));
    for (let i = 1; i <= 100; i++) {
      const p = gen.next();
      expect(p.seq).toBe(i);
      expect(p.isGiant).toBe(i % 10 === 0);
    }
  });

  it('3. NEXT を先読みしても GIANT の番号・種類はずれない', () => {
    const a = new PieceGenerator(mulberry32(7));
    const b = new PieceGenerator(mulberry32(7));
    const peeked = a.peek(6).map((p) => ({ ...p }));
    a.peek(6);
    a.peek(12);
    const fromA = Array.from({ length: 40 }, () => a.next());
    const fromB = Array.from({ length: 40 }, () => b.next());
    expect(fromA).toEqual(fromB);
    expect(fromA.slice(0, 6)).toEqual(peeked);
    expect(fromA.filter((p) => p.isGiant).map((p) => p.seq)).toEqual([10, 20, 30, 40]);
  });

  it('NEXT GIANT は NEXT 先頭=1 で次の GIANT の位置を返す', () => {
    const gen = new PieceGenerator(mulberry32(3));
    expect(gen.distanceToNextGiant()).toBe(10);
    for (let i = 0; i < 7; i++) gen.next();
    expect(gen.distanceToNextGiant()).toBe(3);
    expect(gen.peek(6)[2].isGiant).toBe(true);
    gen.next();
    gen.next();
    expect(gen.distanceToNextGiant()).toBe(1);
    expect(gen.next().isGiant).toBe(true);
    expect(gen.distanceToNextGiant()).toBe(10);
  });
});

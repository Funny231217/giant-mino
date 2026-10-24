import { PIECE_TYPES, type PieceInstance, type PieceType } from './types';

export const GIANT_INTERVAL = 10;

/** 再現性のある乱数（テスト・シード指定用）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 7-bag 供給器。各ミノは生成時に通し番号・種類・GIANT 属性が確定し、
 * 先読み（peek）しても値は変わらない。通し番号が GIANT_INTERVAL の倍数のものだけ GIANT。
 */
export class PieceGenerator {
  private queue: PieceInstance[] = [];
  private bag: PieceType[] = [];
  private generatedCount = 0;
  /** next() で取り出した個数 = 最後に供給したミノの通し番号 */
  suppliedCount = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  private refillBag(): void {
    const bag = [...PIECE_TYPES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.bag = bag;
  }

  private generate(): PieceInstance {
    if (this.bag.length === 0) this.refillBag();
    const type = this.bag.shift()!;
    const seq = ++this.generatedCount;
    return { seq, type, isGiant: seq % GIANT_INTERVAL === 0 };
  }

  private ensure(n: number): void {
    while (this.queue.length < n) this.queue.push(this.generate());
  }

  peek(n: number): readonly PieceInstance[] {
    this.ensure(n);
    return this.queue.slice(0, n);
  }

  next(): PieceInstance {
    this.ensure(1);
    this.suppliedCount++;
    return this.queue.shift()!;
  }

  /**
   * NEXT 先頭を 1 として、次の GIANT が何番目に出てくるか。
   * 供給順だけで決まるので HOLD 交換では変化しない。
   */
  distanceToNextGiant(): number {
    const nextSeq = this.suppliedCount + 1;
    return ((GIANT_INTERVAL - (nextSeq % GIANT_INTERVAL)) % GIANT_INTERVAL) + 1;
  }
}

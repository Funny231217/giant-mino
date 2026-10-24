import { BOARD_HEIGHT, BOARD_WIDTH, PIECE_TYPES, type PieceType } from './types';

/** セル値: 0 = 空, 1..7 = 通常ミノ種別, +8 = GIANT 由来 */
const GIANT_FLAG = 8;

export class Board {
  readonly width = BOARD_WIDTH;
  readonly height = BOARD_HEIGHT;
  cells: number[][];

  constructor() {
    this.cells = Board.emptyCells();
  }

  private static emptyCells(): number[][] {
    return Array.from({ length: BOARD_HEIGHT }, () => new Array<number>(BOARD_WIDTH).fill(0));
  }

  static encode(type: PieceType, isGiant: boolean): number {
    return PIECE_TYPES.indexOf(type) + 1 + (isGiant ? GIANT_FLAG : 0);
  }

  static decode(value: number): { type: PieceType; isGiant: boolean } | null {
    if (value === 0) return null;
    const isGiant = value > GIANT_FLAG;
    const index = (isGiant ? value - GIANT_FLAG : value) - 1;
    return { type: PIECE_TYPES[index], isGiant };
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** 場外は占有扱い（壁・床・天井）。 */
  isOccupied(x: number, y: number): boolean {
    return !this.inBounds(x, y) || this.cells[y][x] !== 0;
  }

  get(x: number, y: number): number {
    return this.inBounds(x, y) ? this.cells[y][x] : 0;
  }

  set(x: number, y: number, value: number): void {
    if (this.inBounds(x, y)) this.cells[y][x] = value;
  }

  fullRows(): number[] {
    const rows: number[] = [];
    for (let y = 0; y < this.height; y++) {
      if (this.cells[y].every((v) => v !== 0)) rows.push(y);
    }
    return rows;
  }

  /** 任意の行数を消去する（4行上限なし）。 */
  clearRows(rows: readonly number[]): void {
    if (rows.length === 0) return;
    const remove = new Set(rows);
    const kept = this.cells.filter((_, y) => !remove.has(y));
    const fresh = Array.from({ length: rows.length }, () => new Array<number>(this.width).fill(0));
    this.cells = [...fresh, ...kept];
  }

  isEmpty(): boolean {
    return this.cells.every((row) => row.every((v) => v === 0));
  }

  clear(): void {
    this.cells = Board.emptyCells();
  }

  /**
   * テスト用: 下詰めで行を指定する。'#' や英字 = 埋まり、'.' = 空。
   * 最後の文字列が最下段 (y = 39) になる。
   */
  static fromStrings(rows: readonly string[]): Board {
    const board = new Board();
    const offset = board.height - rows.length;
    rows.forEach((row, i) => {
      for (let x = 0; x < board.width; x++) {
        const ch = row[x] ?? '.';
        if (ch !== '.' && ch !== ' ') board.cells[offset + i][x] = Board.encode('O', false);
      }
    });
    return board;
  }
}

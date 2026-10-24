import { Board } from './Board';
import { dropDistance, fits } from './CollisionSystem';
import { LockSystem } from './LockSystem';
import { pieceCells, spawnPosition } from './Piece';
import { PieceGenerator, mulberry32 } from './PieceGenerator';
import { tryRotate } from './RotationSystem';
import {
  HARD_DROP_POINTS_PER_ROW,
  SOFT_DROP_POINTS_PER_ROW,
  computeClear,
  gravityIntervalMs,
  levelForLines,
  softDropIntervalMs,
  type ClearResult,
} from './ScoreSystem';
import { detectTSpin, type RotationRecord } from './SpinDetector';
import {
  BOARD_HEIGHT,
  HIDDEN_ROWS,
  type ActivePiece,
  type Cell,
  type GameState,
  type PieceInstance,
  type RotateDir,
  type Rotation,
  type SpinType,
} from './types';

/** 1回の update で進める最大時間。タブ復帰などの時間ジャンプを吸収する。 */
export const MAX_STEP_MS = 100;
/** ライン消去前の発光時間。この間ラインは盤面に残り、次のミノは出現しない。 */
export const LINE_CLEAR_DELAY_MS = 200;

/** 発光中（消去待ち）のライン消去情報 */
interface PendingClear {
  rows: number[];
  spin: SpinType;
  piece: PieceInstance;
  elapsed: number;
}

export type GameEvent =
  | { type: 'spawn'; piece: PieceInstance }
  | { type: 'move' }
  | { type: 'rotate'; kickIndex: number }
  | { type: 'hold'; piece: PieceInstance }
  | { type: 'hardDrop'; distance: number; cells: Cell[]; piece: PieceInstance }
  | { type: 'lock'; cells: Cell[]; piece: PieceInstance }
  | { type: 'lineFlash'; rows: number[]; spin: SpinType; duration: number; piece: PieceInstance }
  | {
      type: 'action';
      rows: number[];
      spin: SpinType;
      perfectClear: boolean;
      result: ClearResult;
      piece: PieceInstance;
    }
  | { type: 'levelUp'; level: number }
  | { type: 'gameOver'; reason: 'blockOut' | 'lockOut' }
  | { type: 'pause' }
  | { type: 'resume' };

export interface EngineOptions {
  seed?: number;
  rng?: () => number;
}

export class GameEngine {
  board = new Board();
  generator: PieceGenerator;
  active: ActivePiece | null = null;
  holdPiece: PieceInstance | null = null;
  canHold = true;
  state: GameState = 'idle';
  score = 0;
  lines = 0;
  level = 1;
  combo = -1;
  b2b = false;
  piecesPlaced = 0;
  elapsedMs = 0;
  softDropping = false;
  lastRotation: RotationRecord | null = null;
  readonly lock = new LockSystem();
  private gravityAcc = 0;
  private pendingClear: PendingClear | null = null;
  private listeners: Array<(e: GameEvent) => void> = [];
  private rngFactory: () => () => number;

  constructor(opts: EngineOptions = {}) {
    this.rngFactory = opts.rng
      ? () => opts.rng!
      : opts.seed !== undefined
        ? () => mulberry32(opts.seed!)
        : () => Math.random;
    this.generator = new PieceGenerator(this.rngFactory());
  }

  on(listener: (e: GameEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }

  start(seed?: number): void {
    this.board = new Board();
    this.generator = new PieceGenerator(seed !== undefined ? mulberry32(seed) : this.rngFactory());
    this.active = null;
    this.holdPiece = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.b2b = false;
    this.piecesPlaced = 0;
    this.elapsedMs = 0;
    this.softDropping = false;
    this.lastRotation = null;
    this.gravityAcc = 0;
    this.pendingClear = null;
    this.state = 'playing';
    this.spawn(this.generator.next());
  }

  /** 操作中のミノがある（発光中・ポーズ中・ゲームオーバーでは false） */
  get isPlaying(): boolean {
    return this.state === 'playing' && this.active !== null;
  }

  /** ライン消去の発光中なら対象行と進行度(0..1) */
  get clearingRows(): { rows: readonly number[]; progress: number } | null {
    const p = this.pendingClear;
    return p ? { rows: p.rows, progress: Math.min(p.elapsed / LINE_CLEAR_DELAY_MS, 1) } : null;
  }

  nextQueue(n = 6): readonly PieceInstance[] {
    return this.generator.peek(n);
  }

  nextGiantIn(): number {
    return this.generator.distanceToNextGiant();
  }

  ghostY(): number | null {
    if (!this.active) return null;
    return this.active.y + dropDistance(this.board, this.active);
  }

  isGrounded(): boolean {
    return this.active !== null && !fits(this.board, this.active, 0, 1);
  }

  // ---- 時間経過 ----

  update(dtMs: number): void {
    if (this.state !== 'playing') return;
    const dt = Math.min(Math.max(dtMs, 0), MAX_STEP_MS);
    if (this.pendingClear) {
      this.elapsedMs += dt;
      this.pendingClear.elapsed += dt;
      if (this.pendingClear.elapsed >= LINE_CLEAR_DELAY_MS) this.finishClear();
      return;
    }
    if (!this.active) return;
    this.elapsedMs += dt;

    const interval = this.softDropping ? softDropIntervalMs(this.level) : gravityIntervalMs(this.level);
    this.gravityAcc += dt;
    let guard = 0;
    while (this.gravityAcc >= interval && guard++ < BOARD_HEIGHT) {
      if (!this.stepDown()) {
        this.gravityAcc = 0;
        break;
      }
      this.gravityAcc -= interval;
      if (this.softDropping) this.score += SOFT_DROP_POINTS_PER_ROW;
    }

    const grounded = this.isGrounded();
    if (grounded) this.gravityAcc = 0;
    if (this.lock.tick(dt, grounded)) this.lockPiece();
  }

  private stepDown(): boolean {
    const a = this.active!;
    if (!fits(this.board, a, 0, 1)) return false;
    a.y++;
    this.lastRotation = null;
    this.lock.onDescend(a.y);
    return true;
  }

  // ---- 操作 ----

  shift(dx: -1 | 1): boolean {
    if (!this.isPlaying) return false;
    const a = this.active!;
    if (!fits(this.board, a, dx, 0)) return false;
    const wasGrounded = this.isGrounded();
    a.x += dx;
    this.afterManipulate(wasGrounded);
    this.emit({ type: 'move' });
    return true;
  }

  /** ARR = 0 用: 移動できる端まで一度に動かす（ロックリセットは1回分）。 */
  shiftToWall(dx: -1 | 1): boolean {
    if (!this.isPlaying) return false;
    const a = this.active!;
    const wasGrounded = this.isGrounded();
    let moved = 0;
    while (fits(this.board, a, dx, 0)) {
      a.x += dx;
      moved++;
    }
    if (moved === 0) return false;
    this.afterManipulate(wasGrounded);
    this.emit({ type: 'move' });
    return true;
  }

  private afterManipulate(wasGrounded: boolean): void {
    this.lastRotation = null;
    this.lock.onManipulate(wasGrounded, this.isGrounded());
  }

  rotate(dir: RotateDir): boolean {
    if (!this.isPlaying) return false;
    const wasGrounded = this.isGrounded();
    const result = tryRotate(this.board, this.active!, dir);
    if (!result) return false;
    this.active = result.piece;
    this.lastRotation = { kickIndex: result.kickIndex };
    this.lock.onManipulate(wasGrounded, this.isGrounded());
    this.lock.onDescend(this.active.y);
    this.emit({ type: 'rotate', kickIndex: result.kickIndex });
    return true;
  }

  setSoftDrop(on: boolean): void {
    if (on && !this.softDropping) {
      // 押した瞬間に落とさず、押下時点から一定間隔で落下させる
      // （自然落下で溜まった時間を持ち越すと押下直後に余分な1段が出るため捨てる）
      this.gravityAcc = 0;
    }
    this.softDropping = on;
  }

  hardDrop(): boolean {
    if (!this.isPlaying) return false;
    const a = this.active!;
    const distance = dropDistance(this.board, a);
    if (distance > 0) {
      a.y += distance;
      this.lastRotation = null;
    }
    this.score += distance * HARD_DROP_POINTS_PER_ROW;
    this.emit({ type: 'hardDrop', distance, cells: pieceCells(a), piece: a.piece });
    this.lockPiece();
    return true;
  }

  hold(): boolean {
    if (!this.isPlaying || !this.canHold) return false;
    const current = this.active!.piece;
    const fromHold = this.holdPiece;
    this.holdPiece = current;
    this.canHold = false;
    this.emit({ type: 'hold', piece: current });
    // 空HOLDへの初回保存のみ NEXT から供給する。交換は供給順を進めない。
    this.spawn(fromHold ?? this.generator.next());
    return true;
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.softDropping = false;
    this.emit({ type: 'pause' });
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.emit({ type: 'resume' });
  }

  // ---- 固定・スポーン ----

  private spawn(piece: PieceInstance): void {
    const { x, y } = spawnPosition(piece.type, piece.isGiant);
    const a: ActivePiece = { piece, rot: 0, x, y };
    this.active = a;
    this.lastRotation = null;
    this.gravityAcc = 0;
    if (!fits(this.board, a)) {
      this.gameOver('blockOut');
      return;
    }
    if (fits(this.board, a, 0, 1)) a.y++;
    this.lock.reset(a.y);
    this.emit({ type: 'spawn', piece });
  }

  private lockPiece(): void {
    const a = this.active!;
    const cells = pieceCells(a);
    // 角の占有はライン消去前に判定する
    const spin = detectTSpin(this.board, a, this.lastRotation);
    const value = Board.encode(a.piece.type, a.piece.isGiant);
    for (const c of cells) this.board.set(c.x, c.y, value);
    this.piecesPlaced++;
    this.emit({ type: 'lock', cells, piece: a.piece });

    this.active = null;
    this.canHold = true;
    const rows = this.board.fullRows();
    if (rows.length > 0) {
      // 消去は発光演出の後。ここでは行を残したまま待機状態に入る
      this.pendingClear = { rows, spin, piece: a.piece, elapsed: 0 };
      this.emit({ type: 'lineFlash', rows, spin, duration: LINE_CLEAR_DELAY_MS, piece: a.piece });
      return;
    }
    this.applyClearResult([], spin, a.piece);
    if (cells.every((c) => c.y < HIDDEN_ROWS)) {
      this.gameOver('lockOut');
      return;
    }
    this.spawn(this.generator.next());
  }

  /** 発光終了: 実際にラインを消去し、得点を確定して次のミノを出す */
  private finishClear(): void {
    const p = this.pendingClear!;
    this.pendingClear = null;
    this.board.clearRows(p.rows);
    this.applyClearResult(p.rows, p.spin, p.piece);
    this.spawn(this.generator.next());
  }

  private applyClearResult(rows: number[], spin: SpinType, piece: PieceInstance): void {
    const perfectClear = rows.length > 0 && this.board.isEmpty();
    const result = computeClear({
      lines: rows.length,
      spin,
      level: this.level,
      b2bActive: this.b2b,
      combo: this.combo,
      perfectClear,
    });
    this.score += result.points;
    this.b2b = result.b2bActive;
    this.combo = result.combo;
    this.lines += rows.length;
    if (rows.length > 0 || spin !== 'none') {
      this.emit({ type: 'action', rows, spin, perfectClear, result, piece });
    }
    const newLevel = levelForLines(this.lines);
    if (newLevel > this.level) {
      this.level = newLevel;
      this.emit({ type: 'levelUp', level: newLevel });
    }
  }

  private gameOver(reason: 'blockOut' | 'lockOut'): void {
    this.state = 'over';
    this.softDropping = false;
    this.emit({ type: 'gameOver', reason });
  }

  // ---- テスト・デバッグ用 ----

  debugSetActive(piece: PieceInstance, rot: Rotation, x: number, y: number): void {
    this.active = { piece, rot, x, y };
    this.lastRotation = null;
    this.lock.reset(y);
    this.gravityAcc = 0;
  }
}

import { Board } from '../core/Board';
import type { GameEngine, GameEvent } from '../core/GameEngine';
import { getShape, pieceCells, shapeBounds } from '../core/Piece';
import { BOARD_HEIGHT, BOARD_WIDTH, HIDDEN_ROWS, type Cell, type PieceInstance, type PieceType } from '../core/types';

/** フィールド描画は非表示バッファの最下2行（スポーン領域）から見せる */
export const VIEW_TOP = HIDDEN_ROWS - 2;
export const VIEW_ROWS = BOARD_HEIGHT - VIEW_TOP;
/** NEXT/HOLD の縮小プレビューの単位（フィールド1セルに対する比率） */
export const PREVIEW_SCALE = 0.5;
export const PREVIEW_COLS = 9;
export const HOLD_ROWS = 5.2;
export const NEXT_ROWS = 21;

interface Palette {
  base: string;
  light: string;
  dark: string;
}

const COLORS: Record<PieceType, Palette> = {
  I: { base: '#2ee6f0', light: '#a6fbff', dark: '#0b8a99' },
  O: { base: '#ffd23f', light: '#fff1a8', dark: '#b38900' },
  T: { base: '#b467ff', light: '#e2c2ff', dark: '#6b2bb8' },
  S: { base: '#45e57a', light: '#b5ffcb', dark: '#1a8f43' },
  Z: { base: '#ff4f7a', light: '#ffb3c6', dark: '#a8173f' },
  J: { base: '#4f7dff', light: '#b9cbff', dark: '#2140a8' },
  L: { base: '#ff9a3c', light: '#ffd3a8', dark: '#b3570a' },
};

interface Popup {
  lines: string[];
  color: string;
  age: number;
  life: number;
  y: number;
  size: number;
}
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  color: string;
  size: number;
}
interface Trail {
  cells: Cell[];
  distance: number;
  color: string;
  age: number;
  life: number;
}
interface LockGlow {
  cells: Cell[];
  age: number;
  life: number;
}

export interface RenderOptions {
  ghost: boolean;
}

function edgeSegments(cells: readonly Cell[]): Array<[number, number, number, number]> {
  const set = new Set(cells.map((c) => `${c.x},${c.y}`));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  const segs: Array<[number, number, number, number]> = [];
  for (const { x, y } of cells) {
    if (!has(x, y - 1)) segs.push([x, y, x + 1, y]);
    if (!has(x, y + 1)) segs.push([x, y + 1, x + 1, y + 1]);
    if (!has(x - 1, y)) segs.push([x, y, x, y + 1]);
    if (!has(x + 1, y)) segs.push([x + 1, y, x + 1, y + 1]);
  }
  return segs;
}

export class CanvasRenderer {
  private cell = 30;
  private unit = 15;
  private dpr = 1;
  private readonly fctx: CanvasRenderingContext2D;
  private readonly hctx: CanvasRenderingContext2D;
  private readonly nctx: CanvasRenderingContext2D;
  private popups: Popup[] = [];
  private particles: Particle[] = [];
  private trails: Trail[] = [];
  private lockGlows: LockGlow[] = [];
  private shake = 0;
  private time = 0;

  constructor(
    private readonly field: HTMLCanvasElement,
    private readonly holdCanvas: HTMLCanvasElement,
    private readonly nextCanvas: HTMLCanvasElement,
  ) {
    this.fctx = field.getContext('2d')!;
    this.hctx = holdCanvas.getContext('2d')!;
    this.nctx = nextCanvas.getContext('2d')!;
  }

  /** @returns プレビュー1単位の px */
  resize(cell: number, previewScale = PREVIEW_SCALE): number {
    this.cell = cell;
    this.unit = Math.max(6, Math.floor(cell * previewScale));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const setup = (c: HTMLCanvasElement, w: number, h: number) => {
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
    };
    setup(this.field, BOARD_WIDTH * cell, VIEW_ROWS * cell);
    setup(this.holdCanvas, PREVIEW_COLS * this.unit, HOLD_ROWS * this.unit);
    setup(this.nextCanvas, PREVIEW_COLS * this.unit, NEXT_ROWS * this.unit);
    return this.unit;
  }

  clearEffects(): void {
    this.popups = [];
    this.particles = [];
    this.trails = [];
    this.lockGlows = [];
    this.shake = 0;
  }

  // ---- イベント → 演出 ----

  onEvent(e: GameEvent): void {
    switch (e.type) {
      case 'spawn':
        if (e.piece.isGiant) this.addPopup(['GIANT MINO!'], '#ff5cf0', 3, 10.5, 1.3);
        break;
      case 'hardDrop':
        if (e.distance > 0) {
          this.trails.push({ cells: e.cells, distance: e.distance, color: COLORS[e.piece.type].base, age: 0, life: 0.16 });
        }
        if (e.piece.isGiant) this.shake = Math.max(this.shake, 0.16);
        break;
      case 'lock':
        this.lockGlows.push({ cells: e.cells, age: 0, life: 0.14 });
        break;
      case 'action': {
        const r = e.result;
        if (e.rows.length > 0) {
          this.burst(e.rows, COLORS[e.piece.type].base, r.isMega ? 3 : 1.4);
        }
        const lines: string[] = [];
        if (r.b2bApplied) lines.push('BACK-TO-BACK');
        lines.push(r.label);
        if (r.combo > 0) lines.push(`${r.combo} COMBO`);
        const color = e.spin !== 'none' ? '#d79bff' : r.isMega ? '#ff5cf0' : e.rows.length >= 4 ? '#5ff3ff' : '#ffffff';
        this.addPopup(lines, color, r.isMega || e.spin === 'full' ? 2.6 : 2, 6.5, 1.25);
        if (e.perfectClear) this.addPopup(['PERFECT', 'CLEAR'], '#ffe45c', 4.2, 13, 1.8);
        if (r.isMega) this.shake = Math.max(this.shake, 0.3);
        break;
      }
      case 'levelUp':
        this.addPopup([`LEVEL ${e.level}`], '#7dffb0', 2.2, 17, 1.1);
        break;
    }
  }

  private addPopup(lines: string[], color: string, size: number, y: number, life: number): void {
    // 同じ位置の古い表示は消す（連続アクションで重ならないように）
    this.popups = this.popups.filter((p) => Math.abs(p.y - y) > 2);
    this.popups.push({ lines, color, age: 0, life, y, size });
  }

  private burst(rows: number[], color: string, strength: number): void {
    for (const row of rows) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const n = strength > 2 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          this.particles.push({
            x: x + 0.5,
            y: row - VIEW_TOP + 0.5,
            vx: (Math.random() - 0.5) * 9 * strength,
            vy: (Math.random() - 0.9) * 8 * strength,
            age: 0,
            life: 0.45 + Math.random() * 0.35,
            color: Math.random() < 0.5 ? color : '#ffffff',
            size: 0.12 + Math.random() * 0.14,
          });
        }
      }
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  // ---- 描画 ----

  render(engine: GameEngine, opts: RenderOptions, dtMs: number): void {
    const dt = dtMs / 1000;
    this.time += dt;
    this.tickEffects(dt);
    this.drawField(engine, opts);
    this.drawHold(engine);
    this.drawNext(engine);
  }

  private tickEffects(dt: number): void {
    const age = <T extends { age: number; life: number }>(list: T[]) => {
      for (const it of list) it.age += dt;
      return list.filter((it) => it.age < it.life);
    };
    this.popups = age(this.popups);
    this.trails = age(this.trails);
    this.lockGlows = age(this.lockGlows);
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 22 * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    this.shake = Math.max(0, this.shake - dt);
  }

  private drawField(engine: GameEngine, opts: RenderOptions): void {
    const ctx = this.fctx;
    const s = this.cell;
    const W = BOARD_WIDTH * s;
    const H = VIEW_ROWS * s;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sx = this.shake > 0 ? (Math.random() - 0.5) * s * 0.25 * (this.shake / 0.3) : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * s * 0.25 * (this.shake / 0.3) : 0;
    ctx.save();
    ctx.translate(sx, sy);

    // 背景
    const top = (HIDDEN_ROWS - VIEW_TOP) * s;
    const bg = ctx.createLinearGradient(0, top, 0, H);
    bg.addColorStop(0, '#0d1022');
    bg.addColorStop(1, '#090b18');
    ctx.fillStyle = bg;
    ctx.fillRect(0, top, W, H - top);
    ctx.fillStyle = 'rgba(255, 60, 120, 0.05)';
    ctx.fillRect(0, 0, W, top);

    // グリッド
    ctx.strokeStyle = 'rgba(140, 160, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < BOARD_WIDTH; x++) {
      ctx.moveTo(x * s + 0.5, top);
      ctx.lineTo(x * s + 0.5, H);
    }
    for (let y = HIDDEN_ROWS - VIEW_TOP + 1; y < VIEW_ROWS; y++) {
      ctx.moveTo(0, y * s + 0.5);
      ctx.lineTo(W, y * s + 0.5);
    }
    ctx.stroke();
    // スポーン境界線
    ctx.strokeStyle = 'rgba(255, 90, 160, 0.35)';
    ctx.setLineDash([s * 0.25, s * 0.2]);
    ctx.beginPath();
    ctx.moveTo(0, top + 0.5);
    ctx.lineTo(W, top + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // 積みブロック
    const board = engine.board;
    for (let y = VIEW_TOP; y < BOARD_HEIGHT; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const d = Board.decode(board.cells[y][x]);
        if (!d) continue;
        const dim = engine.state === 'over' ? 0.45 : 1;
        this.drawBlock(ctx, x * s, (y - VIEW_TOP) * s, s, COLORS[d.type], dim, d.isGiant);
      }
    }

    // ハードドロップの残像
    for (const t of this.trails) {
      const k = 1 - t.age / t.life;
      const cols = new Map<number, number>();
      for (const c of t.cells) cols.set(c.x, Math.min(cols.get(c.x) ?? Infinity, c.y));
      for (const [x, yTop] of cols) {
        const y1 = (yTop - VIEW_TOP) * s;
        const y0 = Math.max(0, y1 - t.distance * s);
        const g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, this.alpha(t.color, 0.35 * k));
        ctx.fillStyle = g;
        ctx.fillRect(x * s + s * 0.1, y0, s * 0.8, y1 - y0);
      }
    }

    // ゴーストと操作中ミノ
    const a = engine.active;
    if (a && engine.state !== 'over') {
      const color = COLORS[a.piece.type];
      const ghostY = engine.ghostY();
      if (opts.ghost && ghostY !== null && ghostY !== a.y) {
        const ghostCells = getShape(a.piece.type, a.piece.isGiant, a.rot).map((c) => ({ x: c.x + a.x, y: c.y + ghostY }));
        for (const c of ghostCells) this.drawGhost(ctx, c.x * s, (c.y - VIEW_TOP) * s, s, color);
        if (a.piece.isGiant) this.drawOutline(ctx, ghostCells, VIEW_TOP, s, this.alpha(color.base, 0.55), false);
      }
      const cells = pieceCells(a);
      for (const c of cells) {
        if (c.y < VIEW_TOP) continue;
        this.drawBlock(ctx, c.x * s, (c.y - VIEW_TOP) * s, s, color, 1, a.piece.isGiant);
      }
      if (a.piece.isGiant) this.drawOutline(ctx, cells, VIEW_TOP, s, '#ffffff', true, color.base);
      // ロックディレイの進行を枠の明るさで示す
      if (engine.isGrounded() && engine.lock.timer > 0) {
        const k = Math.min(engine.lock.timer / engine.lock.delay, 1);
        ctx.fillStyle = `rgba(255,255,255,${0.18 * k})`;
        for (const c of cells) if (c.y >= VIEW_TOP) ctx.fillRect(c.x * s, (c.y - VIEW_TOP) * s, s, s);
      }
    }

    // 固定時の白フラッシュ
    for (const g of this.lockGlows) {
      ctx.fillStyle = `rgba(255,255,255,${0.45 * (1 - g.age / g.life)})`;
      for (const c of g.cells) if (c.y >= VIEW_TOP) ctx.fillRect(c.x * s, (c.y - VIEW_TOP) * s, s, s);
    }

    // ライン消去前の発光（エンジンの消去待ち状態から描く。点滅させず徐々に明るくする）
    const clearing = engine.clearingRows;
    if (clearing) this.drawLineGlow(ctx, clearing.rows, clearing.progress, W);

    // パーティクル
    for (const p of this.particles) {
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.fillStyle = p.color;
      const size = p.size * s;
      ctx.fillRect(p.x * s - size / 2, p.y * s - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 文字演出
    for (const p of this.popups) this.drawPopup(ctx, p, W);
  }

  /** 消去対象ラインの白いネオン発光。progress 0→1 で明るさが単調に増える */
  private drawLineGlow(ctx: CanvasRenderingContext2D, rows: readonly number[], progress: number, W: number): void {
    const s = this.cell;
    const k = 1 - Math.pow(1 - progress, 2); // ease-out
    ctx.save();
    ctx.shadowColor = 'rgba(140, 240, 255, 0.9)';
    ctx.shadowBlur = s * (0.3 + 0.7 * k);
    for (const row of rows) {
      if (row < VIEW_TOP) continue;
      const y = (row - VIEW_TOP) * s;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + 0.6 * k})`;
      ctx.fillRect(0, y, W, s);
    }
    ctx.shadowBlur = 0;
    // 中心線を少し強く光らせてネオン感を出す
    for (const row of rows) {
      if (row < VIEW_TOP) continue;
      const y = (row - VIEW_TOP) * s;
      const g = ctx.createLinearGradient(0, y, 0, y + s);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${0.35 * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, W, s);
    }
    ctx.restore();
  }

  private drawPopup(ctx: CanvasRenderingContext2D, p: Popup, W: number): void {
    const s = this.cell;
    const t = p.age / p.life;
    const appear = Math.min(1, p.age / 0.08);
    const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    const scale = 0.8 + 0.2 * appear;
    const base = p.size * s * 0.42;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = p.color;
    ctx.shadowBlur = s * 0.5;
    let y = (p.y - t * 0.6) * s;
    p.lines.forEach((line, i) => {
      const secondary = line === 'BACK-TO-BACK' || line.endsWith('COMBO');
      let size = base * (secondary ? 0.62 : 1) * scale;
      ctx.font = `900 ${size}px "Segoe UI", "Hiragino Sans", system-ui, sans-serif`;
      const w = ctx.measureText(line).width;
      if (w > W * 0.94) {
        size *= (W * 0.94) / w;
        ctx.font = `900 ${size}px "Segoe UI", "Hiragino Sans", system-ui, sans-serif`;
      }
      ctx.lineWidth = Math.max(2, size * 0.14);
      ctx.strokeStyle = 'rgba(5,6,20,0.9)';
      ctx.strokeText(line, W / 2, y);
      ctx.fillStyle = i === 0 && line === 'BACK-TO-BACK' ? '#ffd166' : p.color;
      ctx.fillText(line, W / 2, y);
      y += size * 1.15;
    });
    ctx.restore();
  }

  private alpha(hex: string, a: number): string {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  private drawBlock(
    ctx: CanvasRenderingContext2D,
    px: number,
    py: number,
    s: number,
    c: Palette,
    alpha = 1,
    giant = false,
  ): void {
    const inset = Math.max(1, s * 0.06);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = c.dark;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = c.base;
    ctx.fillRect(px + inset, py + inset, s - inset * 2, s - inset * 2);
    // 上面ハイライト
    ctx.fillStyle = c.light;
    ctx.globalAlpha = alpha * 0.55;
    ctx.fillRect(px + inset, py + inset, s - inset * 2, Math.max(1, s * 0.14));
    ctx.globalAlpha = alpha * 0.18;
    ctx.fillRect(px + inset, py + inset, Math.max(1, s * 0.12), s - inset * 2);
    if (giant) {
      // GIANT 由来のセルは内側に明るい枠
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = c.light;
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeRect(px + s * 0.22, py + s * 0.22, s * 0.56, s * 0.56);
    }
    ctx.globalAlpha = 1;
  }

  private drawGhost(ctx: CanvasRenderingContext2D, px: number, py: number, s: number, c: Palette): void {
    ctx.fillStyle = this.alpha(c.base, 0.13);
    ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
    ctx.strokeStyle = this.alpha(c.base, 0.55);
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.strokeRect(px + s * 0.08, py + s * 0.08, s * 0.84, s * 0.84);
  }

  /** GIANT の外周に太めの輪郭線（+控えめな発光） */
  private drawOutline(
    ctx: CanvasRenderingContext2D,
    cells: readonly Cell[],
    rowOffset: number,
    s: number,
    stroke: string,
    glow: boolean,
    glowColor = stroke,
  ): void {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(2, s * 0.13);
    ctx.lineCap = 'round';
    if (glow) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = s * (0.45 + 0.15 * Math.sin(this.time * 6));
    }
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of edgeSegments(cells)) {
      ctx.moveTo(x0 * s, (y0 - rowOffset) * s);
      ctx.lineTo(x1 * s, (y1 - rowOffset) * s);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** 縮小プレビュー: 通常も GIANT も同じ単位で描くので大きさの違いがそのまま見える */
  private drawPreview(
    ctx: CanvasRenderingContext2D,
    piece: PieceInstance,
    cx: number,
    cy: number,
    dim = false,
  ): void {
    const u = this.unit;
    const shape = getShape(piece.type, piece.isGiant, 0);
    const b = shapeBounds(shape);
    const w = (b.maxX - b.minX + 1) * u;
    const h = (b.maxY - b.minY + 1) * u;
    const ox = cx - w / 2 - b.minX * u;
    const oy = cy - h / 2 - b.minY * u;
    const color = COLORS[piece.type];
    for (const c of shape) this.drawBlock(ctx, ox + c.x * u, oy + c.y * u, u, color, dim ? 0.3 : 1, piece.isGiant);
    if (piece.isGiant && !dim) {
      const cells = shape.map((c) => ({ x: c.x + ox / u, y: c.y + oy / u }));
      this.drawOutline(ctx, cells, 0, u, '#ffffff', true, color.base);
    }
  }

  private drawBadge(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
    const u = this.unit;
    ctx.save();
    ctx.font = `800 ${Math.max(9, u * 0.62)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(text).width + u * 0.8;
    ctx.fillStyle = 'rgba(255, 70, 220, 0.9)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - u * 0.42, w, u * 0.84, u * 0.42);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  private drawHold(engine: GameEngine): void {
    const ctx = this.hctx;
    const u = this.unit;
    const W = PREVIEW_COLS * u;
    const H = HOLD_ROWS * u;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const p = engine.holdPiece;
    if (!p) return;
    this.drawPreview(ctx, p, W / 2, H / 2 - (p.isGiant ? u * 0.3 : 0), !engine.canHold);
    if (p.isGiant) this.drawBadge(ctx, 'GIANT', W / 2, H - u * 0.5);
  }

  private drawNext(engine: GameEngine): void {
    const ctx = this.nctx;
    const u = this.unit;
    const W = PREVIEW_COLS * u;
    const H = NEXT_ROWS * u;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    let y = u * 0.3;
    engine.nextQueue(6).forEach((p, i) => {
      const slot = p.isGiant ? 5.4 * u : 3 * u;
      if (p.isGiant) {
        ctx.fillStyle = 'rgba(255, 70, 220, 0.08)';
        ctx.strokeStyle = 'rgba(255, 70, 220, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(u * 0.2, y, W - u * 0.4, slot - u * 0.15, u * 0.4);
        ctx.fill();
        ctx.stroke();
      }
      this.drawPreview(ctx, p, W / 2, y + slot / 2 - (p.isGiant ? u * 0.25 : 0));
      if (p.isGiant) this.drawBadge(ctx, `GIANT · ${i + 1}`, W / 2, y + slot - u * 0.55);
      if (i === 0) {
        ctx.fillStyle = 'rgba(120, 240, 255, 0.5)';
        ctx.fillRect(0, y + slot * 0.2, u * 0.15, slot * 0.6);
      }
      y += slot;
    });
  }
}

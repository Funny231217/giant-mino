import type { SpinType } from './types';

export const LINES_PER_LEVEL = 10;
export const MAX_GRAVITY_LEVEL = 20;
/** ソフトドロップ: ↓押下中は 1マス / この時間(ms)。自然落下の方が速いレベルでは自然落下を優先 */
export const SOFT_DROP_INTERVAL_MS = 100;
export const SOFT_DROP_POINTS_PER_ROW = 1;
export const HARD_DROP_POINTS_PER_ROW = 2;

const LINE_NAMES = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];
const LINE_BASE = [0, 100, 300, 500, 800];
const TSPIN_BASE = [400, 800, 1200, 1600];
const TSPIN_MINI_BASE = [100, 200, 400];
const PERFECT_CLEAR_BASE = [0, 800, 1200, 1800, 2000];

/** 5行以上: 800 × (行数 − 3)。4行(=800)からの連続的な延長。 */
export function megaClearBase(lines: number): number {
  return 800 * (lines - 3);
}

export function perfectClearBase(lines: number): number {
  if (lines <= 0) return 0;
  if (lines <= 4) return PERFECT_CLEAR_BASE[lines];
  return 2000 + 400 * (lines - 4);
}

export function levelForLines(lines: number): number {
  return 1 + Math.floor(lines / LINES_PER_LEVEL);
}

/** 自然落下: 1段あたりの時間(ms)。Guideline 系の式 (0.8 − (L−1)·0.007)^(L−1) 秒。 */
export function gravityIntervalMs(level: number): number {
  const l = Math.min(Math.max(level, 1), MAX_GRAVITY_LEVEL);
  return Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000;
}

export function softDropIntervalMs(level: number): number {
  return Math.min(gravityIntervalMs(level), SOFT_DROP_INTERVAL_MS);
}

export interface ClearInput {
  lines: number;
  spin: SpinType;
  level: number;
  /** この固定の直前に B2B が継続中か */
  b2bActive: boolean;
  /** 直前のコンボ値（-1 = コンボなし） */
  combo: number;
  perfectClear: boolean;
}

export interface ClearResult {
  points: number;
  basePoints: number;
  comboBonus: number;
  perfectClearBonus: number;
  /** B2B ×1.5 が適用されたか */
  b2bApplied: boolean;
  /** 固定後の B2B 状態 */
  b2bActive: boolean;
  /** 固定後のコンボ値 */
  combo: number;
  /** B2B の対象となる「難しい消去」か */
  difficult: boolean;
  isMega: boolean;
  label: string;
}

/**
 * 1回の固定に対するスコア計算（純粋関数）。
 * - 難しい消去 = Tetris・MEGA CLEAR(5行以上)・ライン消去を伴う T-Spin / T-Spin Mini
 * - B2B: 難しい消去が連続すると基本点 ×1.5。通常の1〜3行消去で途切れる。0ライン(T-Spin含む)では変化しない
 * - Combo: ライン消去を伴う固定が連続した回数。2連続目から 50 × combo × level
 * - Perfect Clear: 消去後に盤面が空なら perfectClearBase × level を追加
 */
export function computeClear(input: ClearInput): ClearResult {
  const { lines, spin, level } = input;
  let base: number;
  if (spin === 'full') base = TSPIN_BASE[Math.min(lines, 3)];
  else if (spin === 'mini') base = TSPIN_MINI_BASE[Math.min(lines, 2)];
  else if (lines >= 5) base = megaClearBase(lines);
  else base = LINE_BASE[lines];

  const difficult = lines > 0 && (lines >= 4 || spin !== 'none');
  const b2bApplied = difficult && input.b2bActive;
  const basePoints = Math.floor(base * level * (b2bApplied ? 1.5 : 1));
  const b2bActive = lines > 0 ? difficult : input.b2bActive;
  const combo = lines > 0 ? input.combo + 1 : -1;
  const comboBonus = combo > 0 ? 50 * combo * level : 0;
  const perfectClearBonus = input.perfectClear ? perfectClearBase(lines) * level : 0;

  return {
    points: basePoints + comboBonus + perfectClearBonus,
    basePoints,
    comboBonus,
    perfectClearBonus,
    b2bApplied,
    b2bActive,
    combo,
    difficult,
    isMega: lines >= 5,
    label: clearLabel(lines, spin),
  };
}

export function clearLabel(lines: number, spin: SpinType): string {
  const name = lines >= 5 ? `MEGA CLEAR ×${lines}` : LINE_NAMES[lines];
  if (spin === 'full') return lines > 0 ? `T-SPIN ${name}` : 'T-SPIN';
  if (spin === 'mini') return lines > 0 ? `T-SPIN MINI ${name}` : 'T-SPIN MINI';
  return name;
}

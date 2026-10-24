import type { RotateDir } from './types';

export type InputAction =
  | 'left'
  | 'right'
  | 'softDrop'
  | 'hardDrop'
  | 'rotateCW'
  | 'rotateCCW'
  | 'hold'
  | 'pause'
  | 'mute';

/** KeyboardEvent.code → 操作。Touch* はタッチボタン用の仮想キー。 */
export const DEFAULT_KEYMAP: Readonly<Record<string, InputAction>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'softDrop',
  Space: 'hardDrop',
  ArrowUp: 'rotateCW',
  KeyX: 'rotateCW',
  KeyZ: 'rotateCCW',
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
  KeyP: 'pause',
  Escape: 'pause',
  KeyM: 'mute',
  TouchLeft: 'left',
  TouchRight: 'right',
  TouchSoft: 'softDrop',
  TouchHard: 'hardDrop',
  TouchCW: 'rotateCW',
  TouchCCW: 'rotateCCW',
  TouchHold: 'hold',
};

export interface InputTarget {
  shift(dx: -1 | 1): boolean;
  shiftToWall(dx: -1 | 1): boolean;
  setSoftDrop(on: boolean): void;
  hardDrop(): void;
  rotate(dir: RotateDir): void;
  hold(): void;
  togglePause(): void;
  toggleMute(): void;
  isPlaying(): boolean;
}

/**
 * 独自の DAS / ARR 処理。OS のキーリピートは使わない。
 * - 同じキーの keydown は keyup まで無視する（ハードドロップ・HOLD・回転の多重発火防止）
 * - 左右同時押しは後から押した方を優先。離すと残っている方向で DAS をやり直す
 * - ARR = 0 なら DAS 経過後に端まで即移動
 */
export class InputManager {
  das: number;
  arr: number;
  private held = new Set<string>();
  private dirStack: Array<{ code: string; dir: -1 | 1 }> = [];
  private dasTimer = 0;
  private arrTimer = 0;
  private charged = false;

  constructor(
    private readonly target: InputTarget,
    opts: { das: number; arr: number },
    private readonly keymap: Readonly<Record<string, InputAction>> = DEFAULT_KEYMAP,
  ) {
    this.das = opts.das;
    this.arr = opts.arr;
  }

  isGameKey(code: string): boolean {
    return code in this.keymap;
  }

  /** 処理対象のキーなら true（呼び出し側で preventDefault する）。 */
  keyDown(code: string): boolean {
    const action = this.keymap[code];
    if (!action) return false;
    if (this.held.has(code)) return true;
    this.held.add(code);
    const playing = this.target.isPlaying();

    switch (action) {
      case 'left':
      case 'right': {
        const dir = action === 'left' ? -1 : 1;
        this.dirStack = this.dirStack.filter((d) => d.code !== code);
        this.dirStack.push({ code, dir });
        this.resetRepeat();
        if (playing) this.target.shift(dir);
        break;
      }
      case 'softDrop':
        this.target.setSoftDrop(true);
        break;
      case 'hardDrop':
        if (playing) this.target.hardDrop();
        break;
      case 'rotateCW':
        if (playing) this.target.rotate(1);
        break;
      case 'rotateCCW':
        if (playing) this.target.rotate(-1);
        break;
      case 'hold':
        if (playing) this.target.hold();
        break;
      case 'pause':
        this.target.togglePause();
        break;
      case 'mute':
        this.target.toggleMute();
        break;
    }
    return true;
  }

  keyUp(code: string): boolean {
    const action = this.keymap[code];
    if (!action) return false;
    this.held.delete(code);
    if (action === 'left' || action === 'right') {
      const wasActive = this.dirStack[this.dirStack.length - 1]?.code === code;
      this.dirStack = this.dirStack.filter((d) => d.code !== code);
      if (wasActive) this.resetRepeat();
    } else if (action === 'softDrop' && !this.isActionHeld('softDrop')) {
      this.target.setSoftDrop(false);
    }
    return true;
  }

  /** フォーカス喪失・ポーズ時などに全キーを離した扱いにする。 */
  releaseAll(): void {
    this.held.clear();
    this.dirStack = [];
    this.resetRepeat();
    this.target.setSoftDrop(false);
  }

  isActionHeld(action: InputAction): boolean {
    for (const code of this.held) if (this.keymap[code] === action) return true;
    return false;
  }

  private resetRepeat(): void {
    this.dasTimer = 0;
    this.arrTimer = 0;
    this.charged = false;
  }

  update(dtMs: number): void {
    const cur = this.dirStack[this.dirStack.length - 1];
    if (!cur || !this.target.isPlaying()) return;

    if (!this.charged) {
      this.dasTimer += dtMs;
      if (this.dasTimer < this.das) return;
      this.charged = true;
      this.arrTimer = this.dasTimer - this.das;
      if (this.arr <= 0) {
        this.target.shiftToWall(cur.dir);
        return;
      }
      this.target.shift(cur.dir);
    } else {
      if (this.arr <= 0) {
        this.target.shiftToWall(cur.dir);
        return;
      }
      this.arrTimer += dtMs;
    }

    let guard = 0;
    while (this.arrTimer >= this.arr && guard++ < 20) {
      this.arrTimer -= this.arr;
      if (!this.target.shift(cur.dir)) {
        this.arrTimer = 0;
        break;
      }
    }
  }
}

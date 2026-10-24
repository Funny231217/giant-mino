export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;

/**
 * ロックディレイ（Extended Placement 方式）。
 * - 接地中のみタイマーが進み、LOCK_DELAY_MS に達したら固定。
 * - 接地に関わる移動・回転の成功でタイマーを 0 に戻す。ただし最大 MAX_LOCK_RESETS 回。
 * - それまでの最下段より下へ落ちたときだけリセット回数を 0 に戻す（無限粘り防止）。
 */
export class LockSystem {
  timer = 0;
  resets = 0;
  lowestY = -Infinity;

  constructor(
    readonly delay = LOCK_DELAY_MS,
    readonly maxResets = MAX_LOCK_RESETS,
  ) {}

  reset(y: number): void {
    this.timer = 0;
    this.resets = 0;
    this.lowestY = y;
  }

  onDescend(y: number): void {
    if (y > this.lowestY) {
      this.lowestY = y;
      this.timer = 0;
      this.resets = 0;
    }
  }

  /** 移動・回転成功時に呼ぶ。リセットが行われたら true。 */
  onManipulate(wasGrounded: boolean, nowGrounded: boolean): boolean {
    if (!wasGrounded && !nowGrounded) return false;
    if (this.resets >= this.maxResets) return false;
    this.resets++;
    this.timer = 0;
    return true;
  }

  /** 経過時間を加算し、固定すべきなら true。 */
  tick(dt: number, grounded: boolean): boolean {
    if (!grounded) return false;
    this.timer += dt;
    return this.timer >= this.delay;
  }
}

import { describe, expect, it } from 'vitest';
import { Board } from '../core/Board';
import { GameEngine, MAX_STEP_MS } from '../core/GameEngine';
import { InputManager, type InputTarget } from '../core/InputManager';
import { LOCK_DELAY_MS, MAX_LOCK_RESETS } from '../core/LockSystem';
import { computeClear, megaClearBase } from '../core/ScoreSystem';
import { advance, collect, finishClear, inst } from './helpers';

function skipToSeq(engine: GameEngine, seq: number) {
  while (engine.active!.piece.seq < seq) {
    engine.hardDrop();
    engine.board.clear();
  }
}

describe('13-15. HOLD', () => {
  it('13. 設置まで1回、設置後に再使用できる', () => {
    const engine = new GameEngine({ seed: 2 });
    engine.start();
    expect(engine.hold()).toBe(true);
    expect(engine.hold()).toBe(false);
    engine.hardDrop();
    expect(engine.hold()).toBe(true);
  });

  it('14. HOLD 中も GIANT 属性と通し番号を維持し、初期姿勢・正規位置で戻る', () => {
    const engine = new GameEngine({ seed: 2 });
    engine.start();
    skipToSeq(engine, 10);
    const giant = engine.active!.piece;
    expect(giant).toMatchObject({ seq: 10, isGiant: true });
    engine.rotate(1);
    engine.shift(-1);
    engine.hold();
    expect(engine.holdPiece).toBe(giant);
    expect(engine.active!.piece.seq).toBe(11);
    engine.hardDrop();
    engine.board.clear();
    engine.hold();
    const back = engine.active!;
    expect(back.piece).toBe(giant);
    expect(back.rot).toBe(0);
    expect(engine.holdPiece!.seq).toBe(12);
    // 正規スポーン位置 = 新規スポーン時と同じ
    expect(back.x).toBe(giant.type === 'I' ? 1 : giant.type === 'O' ? 3 : 2);
  });

  it('15. HOLD 交換では供給番号・NEXT GIANT が変化しない（初回のみ供給が進む）', () => {
    const engine = new GameEngine({ seed: 9 });
    engine.start();
    expect(engine.generator.suppliedCount).toBe(1);
    const nextBefore = engine.nextQueue().map((p) => p.seq);
    engine.hold(); // 空 HOLD → NEXT から供給
    expect(engine.generator.suppliedCount).toBe(2);
    expect(engine.nextGiantIn()).toBe(8);
    engine.hardDrop();
    const supplied = engine.generator.suppliedCount;
    const giantIn = engine.nextGiantIn();
    const next = engine.nextQueue().map((p) => p.seq);
    engine.hold(); // 交換
    expect(engine.generator.suppliedCount).toBe(supplied);
    expect(engine.nextGiantIn()).toBe(giantIn);
    expect(engine.nextQueue().map((p) => p.seq)).toEqual(next);
    expect(nextBefore[0]).toBe(2);
  });
});

describe('17. 5行以上の同時消去 (MEGA CLEAR)', () => {
  it('GIANT I 縦で5行消去 → MEGA CLEAR ×5', () => {
    const engine = new GameEngine({ seed: 3 });
    engine.start();
    engine.board = Board.fromStrings(Array(5).fill('####..####'));
    const events = collect(engine);
    engine.debugSetActive(inst('I', true), 1, 0, 20); // 列 4,5 の縦 2×8
    engine.hardDrop();
    finishClear(engine);
    const action = events.find((e) => e.type === 'action');
    expect(action && action.type === 'action').toBe(true);
    if (action?.type !== 'action') return;
    expect(action.rows).toHaveLength(5);
    expect(action.result.isMega).toBe(true);
    expect(action.result.label).toBe('MEGA CLEAR ×5');
    expect(action.result.basePoints).toBe(megaClearBase(5));
    expect(action.perfectClear).toBe(false);
    expect(engine.lines).toBe(5);
    // 残り: 列4-5 の 3行分 = 6セル
    expect(engine.board.cells.flat().filter((v) => v !== 0)).toHaveLength(6);
  });

  it('8行同時消去 + Perfect Clear', () => {
    const engine = new GameEngine({ seed: 3 });
    engine.start();
    engine.board = Board.fromStrings(Array(8).fill('####..####'));
    const events = collect(engine);
    engine.debugSetActive(inst('I', true), 1, 0, 20);
    engine.hardDrop();
    finishClear(engine);
    const action = events.find((e) => e.type === 'action');
    if (action?.type !== 'action') throw new Error('no action');
    expect(action.rows).toHaveLength(8);
    expect(action.perfectClear).toBe(true);
    expect(engine.board.isEmpty()).toBe(true);
    expect(action.result.label).toBe('MEGA CLEAR ×8');
  });

  it('MEGA CLEAR の基本点は行数に応じて増加する', () => {
    expect([5, 6, 7, 8].map(megaClearBase)).toEqual([1600, 2400, 3200, 4000]);
  });
});

describe('18. Combo / Back-to-Back / Perfect Clear 計算', () => {
  const base = { spin: 'none' as const, level: 1, b2bActive: false, combo: -1, perfectClear: false };

  it('Combo: 2連続目から 50 × combo × level、0ライン固定でリセット', () => {
    const r1 = computeClear({ ...base, lines: 1 });
    expect([r1.combo, r1.comboBonus, r1.points]).toEqual([0, 0, 100]);
    const r2 = computeClear({ ...base, lines: 2, combo: r1.combo });
    expect([r2.combo, r2.comboBonus, r2.points]).toEqual([1, 50, 350]);
    const r3 = computeClear({ ...base, lines: 1, combo: r2.combo, level: 3 });
    expect([r3.combo, r3.comboBonus, r3.points]).toEqual([2, 300, 600]);
    expect(computeClear({ ...base, lines: 0, combo: 5 }).combo).toBe(-1);
  });

  it('B2B: Tetris→Tetris で ×1.5、通常消去で途切れる、0ラインでは維持', () => {
    const t1 = computeClear({ ...base, lines: 4 });
    expect([t1.basePoints, t1.b2bActive, t1.b2bApplied]).toEqual([800, true, false]);
    const t2 = computeClear({ ...base, lines: 4, b2bActive: t1.b2bActive });
    expect([t2.basePoints, t2.b2bApplied]).toEqual([1200, true]);
    const keep = computeClear({ ...base, lines: 0, b2bActive: true });
    expect(keep.b2bActive).toBe(true);
    const keepSpin = computeClear({ ...base, lines: 0, spin: 'full', b2bActive: true });
    expect(keepSpin.b2bActive).toBe(true);
    const broken = computeClear({ ...base, lines: 1, b2bActive: true });
    expect(broken.b2bActive).toBe(false);
    const tsd = computeClear({ ...base, lines: 2, spin: 'full', b2bActive: true });
    expect([tsd.basePoints, tsd.b2bApplied]).toEqual([1800, true]);
    const mega = computeClear({ ...base, lines: 6, b2bActive: true });
    expect([mega.basePoints, mega.b2bApplied, mega.b2bActive]).toEqual([3600, true, true]);
  });

  it('Perfect Clear ボーナス', () => {
    expect(computeClear({ ...base, lines: 1, perfectClear: true }).points).toBe(900);
    expect(computeClear({ ...base, lines: 4, perfectClear: true }).perfectClearBonus).toBe(2000);
    expect(computeClear({ ...base, lines: 6, perfectClear: true, level: 2 }).perfectClearBonus).toBe(5600);
  });

  it('エンジン上で I による Perfect Clear が発火する', () => {
    const engine = new GameEngine({ seed: 4 });
    engine.start();
    engine.board = Board.fromStrings(['###....###']);
    const events = collect(engine);
    engine.debugSetActive(inst('I'), 0, 3, 30);
    engine.hardDrop();
    finishClear(engine);
    const a = events.find((e) => e.type === 'action');
    if (a?.type !== 'action') throw new Error('no action');
    expect(a.perfectClear).toBe(true);
    expect(a.result.points).toBe(900);
  });

  it('エンジン上で Combo と B2B が状態として継続する', () => {
    const engine = new GameEngine({ seed: 4 });
    engine.start();
    engine.board = Board.fromStrings(['#.########', '#.########', '#.########', '#.########', '#.########', '#.########', '#.########', '#.########']);
    engine.debugSetActive(inst('I'), 1, -1, 30);
    engine.hardDrop();
    finishClear(engine);
    expect([engine.combo, engine.b2b]).toEqual([0, true]);
    engine.debugSetActive(inst('I'), 1, -1, 30);
    const before = engine.score;
    engine.hardDrop();
    finishClear(engine);
    expect([engine.combo, engine.b2b]).toEqual([1, true]);
    // Tetris B2B 1200 + combo 50 + PC 2000 + hard drop
    expect(engine.score - before).toBeGreaterThanOrEqual(1200 + 50 + 2000);
  });
});

describe('19. ロックディレイ', () => {
  it('接地から 500ms で固定', () => {
    const engine = new GameEngine({ seed: 6 });
    engine.start();
    engine.board.clear();
    engine.debugSetActive(inst('T', false, 500), 0, 3, 38);
    advance(engine, LOCK_DELAY_MS - 10);
    expect(engine.active!.piece.seq).toBe(500);
    advance(engine, 10);
    expect(engine.active!.piece.seq).not.toBe(500);
    expect(engine.piecesPlaced).toBe(1);
  });

  it('移動でリセットできるのは最大15回', () => {
    const engine = new GameEngine({ seed: 6 });
    engine.start();
    engine.board.clear();
    engine.debugSetActive(inst('T', false, 500), 0, 3, 38);
    for (let i = 0; i < MAX_LOCK_RESETS; i++) {
      advance(engine, 400);
      expect(engine.shift(i % 2 === 0 ? 1 : -1)).toBe(true);
      expect(engine.lock.timer).toBe(0);
    }
    expect(engine.lock.resets).toBe(MAX_LOCK_RESETS);
    advance(engine, 400);
    expect(engine.active!.piece.seq).toBe(500);
    engine.shift(1); // 16回目: リセットされない
    expect(engine.lock.timer).toBeGreaterThanOrEqual(400);
    advance(engine, 100);
    expect(engine.active!.piece.seq).not.toBe(500);
  });

  it('新しい最下段に到達するとリセット回数が戻る', () => {
    const engine = new GameEngine({ seed: 6 });
    engine.start();
    engine.board = Board.fromStrings(['#####.....']);
    engine.debugSetActive(inst('O', false, 500), 0, 3, 37); // 列3-4・行37-38、下の行39が埋まっていて接地
    expect(engine.isGrounded()).toBe(true);
    for (let i = 0; i < 5; i++) {
      engine.shift(-1);
      engine.shift(1);
    }
    expect(engine.lock.resets).toBe(10);
    engine.shift(1);
    engine.shift(1); // 列5-6 へ → 下が空いている
    expect(engine.isGrounded()).toBe(false);
    advance(engine, 1010);
    expect(engine.active!.piece.seq).toBe(500);
    expect(engine.active!.y).toBe(38);
    expect(engine.lock.resets).toBe(0);
  });
});

describe('20. トップアウト', () => {
  it('スポーン位置が埋まっていればゲームオーバー', () => {
    const engine = new GameEngine({ seed: 8 });
    const events = collect(engine);
    engine.start();
    for (let y = 18; y < 40; y++) for (let x = 1; x < 10; x++) engine.board.set(x, y, 1);
    engine.hold();
    expect(engine.state).toBe('over');
    expect(events.some((e) => e.type === 'gameOver' && e.reason === 'blockOut')).toBe(true);
    expect(engine.shift(1)).toBe(false);
    expect(engine.hardDrop()).toBe(false);
  });

  it('積み上げ続けるといずれゲームオーバーになる', () => {
    const engine = new GameEngine({ seed: 8 });
    engine.start();
    let n = 0;
    while (engine.state === 'playing' && n++ < 200) engine.hardDrop();
    expect(engine.state).toBe('over');
  });
});

class MockTarget implements InputTarget {
  calls: string[] = [];
  playing = true;
  shift(dx: -1 | 1) {
    this.calls.push(`shift${dx}`);
    return true;
  }
  shiftToWall(dx: -1 | 1) {
    this.calls.push(`wall${dx}`);
    return true;
  }
  setSoftDrop(on: boolean) {
    this.calls.push(`soft:${on}`);
  }
  hardDrop() {
    this.calls.push('hard');
  }
  rotate(dir: 1 | -1) {
    this.calls.push(`rot${dir}`);
  }
  hold() {
    this.calls.push('hold');
  }
  togglePause() {
    this.calls.push('pause');
  }
  toggleMute() {
    this.calls.push('mute');
  }
  isPlaying() {
    return this.playing;
  }
}

describe('21. 入力（ハードドロップ長押し・DAS/ARR）', () => {
  it('ハードドロップを押しっぱなし（OSリピート含む）でも1回だけ', () => {
    const t = new MockTarget();
    const input = new InputManager(t, { das: 150, arr: 30 });
    input.keyDown('Space');
    input.keyDown('Space');
    input.keyDown('Space');
    input.update(1000);
    expect(t.calls.filter((c) => c === 'hard')).toHaveLength(1);
    input.keyUp('Space');
    input.keyDown('Space');
    expect(t.calls.filter((c) => c === 'hard')).toHaveLength(2);
  });

  it('ハードドロップ長押しで次のミノが連続確定されない（エンジン連携）', () => {
    const engine = new GameEngine({ seed: 10 });
    engine.start();
    const target: InputTarget = {
      shift: (d) => engine.shift(d),
      shiftToWall: (d) => engine.shiftToWall(d),
      setSoftDrop: (on) => engine.setSoftDrop(on),
      hardDrop: () => engine.hardDrop(),
      rotate: (d) => engine.rotate(d),
      hold: () => engine.hold(),
      togglePause: () => {},
      toggleMute: () => {},
      isPlaying: () => engine.state === 'playing',
    };
    const input = new InputManager(target, { das: 150, arr: 30 });
    input.keyDown('Space');
    for (let i = 0; i < 30; i++) {
      input.keyDown('Space'); // OS のキーリピート
      input.update(16);
      engine.update(16);
    }
    expect(engine.piecesPlaced).toBe(1);
    input.keyDown('KeyC');
    input.keyDown('KeyC');
    expect(engine.holdPiece).not.toBeNull();
    expect(engine.canHold).toBe(false);
  });

  it('DAS 150ms 後に ARR 30ms 間隔で移動', () => {
    const t = new MockTarget();
    const input = new InputManager(t, { das: 150, arr: 30 });
    input.keyDown('ArrowLeft');
    expect(t.calls).toEqual(['shift-1']);
    input.update(149);
    expect(t.calls).toHaveLength(1);
    input.update(1); // DAS 到達
    expect(t.calls).toHaveLength(2);
    input.update(29);
    expect(t.calls).toHaveLength(2);
    input.update(1);
    expect(t.calls).toHaveLength(3);
    input.update(90);
    expect(t.calls).toHaveLength(6);
  });

  it('ARR=0 なら DAS 後に端まで即移動', () => {
    const t = new MockTarget();
    const input = new InputManager(t, { das: 100, arr: 0 });
    input.keyDown('ArrowRight');
    input.update(100);
    expect(t.calls).toEqual(['shift1', 'wall1']);
  });

  it('左右同時押しは後から押した方向が優先、離すと元の方向で DAS やり直し', () => {
    const t = new MockTarget();
    const input = new InputManager(t, { das: 100, arr: 50 });
    input.keyDown('ArrowLeft');
    input.update(120);
    input.keyDown('ArrowRight');
    expect(t.calls.at(-1)).toBe('shift1');
    input.update(100);
    expect(t.calls.at(-1)).toBe('shift1');
    input.keyUp('ArrowRight');
    const n = t.calls.length;
    input.update(99);
    expect(t.calls.length).toBe(n);
    input.update(1);
    expect(t.calls.at(-1)).toBe('shift-1');
  });

  it('ソフトドロップは両方のキーを離すまで継続', () => {
    const t = new MockTarget();
    const input = new InputManager(t, { das: 100, arr: 50 });
    input.keyDown('ArrowDown');
    input.keyDown('TouchSoft');
    input.keyUp('ArrowDown');
    expect(t.calls).toEqual(['soft:true', 'soft:true']);
    input.keyUp('TouchSoft');
    expect(t.calls.at(-1)).toBe('soft:false');
  });

  it('ポーズ中は移動・回転しない', () => {
    const t = new MockTarget();
    t.playing = false;
    const input = new InputManager(t, { das: 100, arr: 50 });
    input.keyDown('ArrowLeft');
    input.keyDown('Space');
    input.keyDown('KeyX');
    input.update(500);
    input.keyDown('KeyP');
    expect(t.calls).toEqual(['pause']);
  });
});

describe('22. ポーズ・復帰・時間ジャンプ', () => {
  it('ポーズ中は時間が進まず、復帰直後の巨大 dt はクランプされる', () => {
    const engine = new GameEngine({ seed: 12 });
    engine.start();
    const y0 = engine.active!.y;
    engine.pause();
    for (let i = 0; i < 10; i++) engine.update(5000);
    expect(engine.active!.y).toBe(y0);
    expect(engine.elapsedMs).toBe(0);
    expect(engine.hardDrop()).toBe(false);
    engine.resume();
    engine.update(60_000); // タブ復帰で 1 分飛んだ想定
    expect(engine.elapsedMs).toBe(MAX_STEP_MS);
    expect(engine.active!.y).toBe(y0); // レベル1の重力 1000ms/段 では落ちない
    expect(engine.piecesPlaced).toBe(0);
  });

  it('自然落下は経過時間に比例する（フレームレート非依存）', () => {
    const a = new GameEngine({ seed: 13 });
    const b = new GameEngine({ seed: 13 });
    a.start();
    b.start();
    advance(a, 3000, 16);
    advance(b, 3000, 33);
    expect(a.active!.y).toBe(b.active!.y);
    expect(a.active!.y).toBeGreaterThan(19);
  });
});

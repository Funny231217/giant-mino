import { describe, expect, it } from 'vitest';
import { Board } from '../core/Board';
import { GameEngine, LINE_CLEAR_DELAY_MS } from '../core/GameEngine';
import { InputManager, type InputTarget } from '../core/InputManager';
import { SOFT_DROP_INTERVAL_MS, gravityIntervalMs, softDropIntervalMs } from '../core/ScoreSystem';
import { advance, collect, inst } from './helpers';

function engineTarget(engine: GameEngine): InputTarget {
  return {
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
}

/** 列1だけ空いた2行 + 縦 I を列1に置いた状態（ハードドロップで2行同時消去） */
function setupDouble(): GameEngine {
  const engine = new GameEngine({ seed: 21 });
  engine.start();
  engine.board = Board.fromStrings(['#.########', '#.########']);
  engine.debugSetActive(inst('I', false, 900), 1, -1, 30);
  return engine;
}

describe('ライン消去前の発光', () => {
  it('発光中 (200ms) はラインが盤面に残り、次のミノが出ない。終了後に消去・再開', () => {
    const engine = setupDouble();
    const events = collect(engine);
    engine.hardDrop();
    const flash = events.find((e) => e.type === 'lineFlash');
    expect(flash?.type === 'lineFlash' && flash.rows).toEqual([38, 39]);
    expect(engine.board.fullRows()).toEqual([38, 39]); // 複数ラインが同時に発光対象
    expect(engine.active).toBeNull();
    expect(engine.clearingRows!.rows).toEqual([38, 39]);
    expect(events.some((e) => e.type === 'action')).toBe(false);

    advance(engine, LINE_CLEAR_DELAY_MS - 10);
    expect(engine.board.fullRows()).toHaveLength(2);
    expect(engine.active).toBeNull();
    expect(engine.clearingRows!.progress).toBeGreaterThan(0.9);

    advance(engine, 10);
    expect(engine.clearingRows).toBeNull();
    expect(engine.board.fullRows()).toEqual([]);
    expect(engine.board.get(1, 38) !== 0 && engine.board.get(1, 39) !== 0).toBe(true); // 上の I 2セルが落下
    expect(engine.lines).toBe(2);
    expect(events.some((e) => e.type === 'action')).toBe(true);
    expect(engine.active).not.toBeNull();
  });

  it('発光中の移動・回転・HOLD・ハードドロップは無視される', () => {
    const engine = setupDouble();
    engine.hardDrop();
    expect(engine.shift(-1)).toBe(false);
    expect(engine.rotate(1)).toBe(false);
    expect(engine.hold()).toBe(false);
    expect(engine.hardDrop()).toBe(false);
    advance(engine, LINE_CLEAR_DELAY_MS);
    expect(engine.active!.rot).toBe(0);
    expect(engine.piecesPlaced).toBe(1);
    expect(engine.holdPiece).toBeNull();
    expect(engine.canHold).toBe(true);
  });

  it('発光中のキー入力（InputManager 経由）も次のミノに持ち越されない', () => {
    const engine = setupDouble();
    const input = new InputManager(engineTarget(engine), { das: 150, arr: 30 });
    input.keyDown('Space');
    input.keyUp('Space');
    input.keyDown('Space'); // 発光中の再ハードドロップ
    input.keyDown('KeyX');
    input.keyDown('KeyC');
    advance(engine, LINE_CLEAR_DELAY_MS);
    expect(engine.piecesPlaced).toBe(1);
    expect(engine.active!.rot).toBe(0);
    expect(engine.holdPiece).toBeNull();
  });

  it('ポーズ中は発光の進行も止まる', () => {
    const engine = setupDouble();
    engine.hardDrop();
    advance(engine, 100);
    engine.pause();
    for (let i = 0; i < 20; i++) engine.update(100);
    expect(engine.clearingRows!.progress).toBeCloseTo(0.5);
    engine.resume();
    advance(engine, 100);
    expect(engine.clearingRows).toBeNull();
  });

  it('ライン消去なしの固定は待ち時間なしで次のミノが出る', () => {
    const engine = new GameEngine({ seed: 22 });
    engine.start();
    engine.hardDrop();
    expect(engine.active).not.toBeNull();
    expect(engine.clearingRows).toBeNull();
  });

  it('GIANT による MEGA CLEAR も発光してから消去される', () => {
    const engine = new GameEngine({ seed: 23 });
    engine.start();
    engine.board = Board.fromStrings(Array(6).fill('####..####'));
    engine.debugSetActive(inst('I', true), 1, 0, 20);
    engine.hardDrop();
    expect(engine.clearingRows!.rows).toHaveLength(6);
    expect(engine.lines).toBe(0);
    advance(engine, LINE_CLEAR_DELAY_MS);
    expect(engine.lines).toBe(6);
  });
});

describe('ソフトドロップ速度', () => {
  it('押した瞬間には落ちず、100ms ごとに1マスの一定速度。離すと通常落下に戻る', () => {
    expect(SOFT_DROP_INTERVAL_MS).toBe(100);
    expect(softDropIntervalMs(1)).toBe(100);
    const engine = new GameEngine({ seed: 30 });
    engine.start();
    engine.board.clear();
    engine.debugSetActive(inst('T', false, 700), 0, 3, 20);
    engine.setSoftDrop(true);
    advance(engine, 90);
    expect(engine.active!.y).toBe(20); // 押下直後は落ちない
    advance(engine, 10);
    expect(engine.active!.y).toBe(21); // 100ms で1マス目
    advance(engine, 900);
    expect(engine.active!.y).toBe(30); // 1000ms で10マス
    engine.setSoftDrop(false);
    advance(engine, gravityIntervalMs(1) - 20);
    expect(engine.active!.y).toBe(30);
  });

  it('自然落下で溜まった時間があっても、押下直後に余分な1マスが出ない', () => {
    const engine = new GameEngine({ seed: 33 });
    engine.start();
    engine.board.clear();
    engine.debugSetActive(inst('T', false, 703), 0, 3, 20);
    advance(engine, 950); // 自然落下(1000ms/段)の直前
    expect(engine.active!.y).toBe(20);
    engine.setSoftDrop(true);
    advance(engine, 90);
    expect(engine.active!.y).toBe(20);
    advance(engine, 10);
    expect(engine.active!.y).toBe(21);
  });

  it('OS のキーリピートやタッチとの同時押しで速くならない', () => {
    const engine = new GameEngine({ seed: 31 });
    engine.start();
    engine.board.clear();
    engine.debugSetActive(inst('T', false, 701), 0, 3, 20);
    const input = new InputManager(engineTarget(engine), { das: 150, arr: 30 });
    input.keyDown('ArrowDown');
    for (let t = 0; t < 500; t += 10) {
      input.keyDown('ArrowDown');
      input.keyDown('TouchSoft');
      input.update(10);
      engine.update(10);
    }
    expect(engine.active!.y).toBe(25); // 100,200,…,500ms の5回
  });

  it('ソフトドロップ中も左右移動・回転でき、接地後はロックディレイ後に固定', () => {
    const engine = new GameEngine({ seed: 32 });
    engine.start();
    engine.board.clear();
    engine.debugSetActive(inst('T', false, 702), 0, 3, 36);
    engine.setSoftDrop(true);
    advance(engine, 200);
    expect(engine.active!.y).toBe(38);
    expect(engine.shift(1)).toBe(true);
    expect(engine.rotate(-1)).toBe(true);
    advance(engine, 400);
    expect(engine.active!.piece.seq).toBe(702);
    advance(engine, 200);
    expect(engine.active!.piece.seq).not.toBe(702);
  });

  it('高レベルで自然落下の方が速い場合はそちらを優先する', () => {
    expect(gravityIntervalMs(15)).toBeLessThan(SOFT_DROP_INTERVAL_MS);
    expect(softDropIntervalMs(15)).toBe(gravityIntervalMs(15));
  });
});

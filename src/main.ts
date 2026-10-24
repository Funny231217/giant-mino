import './styles/main.css';
import { AudioManager } from './audio/AudioManager';
import { GameEngine, MAX_STEP_MS, type GameEvent } from './core/GameEngine';
import { InputManager, type InputTarget } from './core/InputManager';
import { BOARD_WIDTH } from './core/types';
import { CanvasRenderer, PREVIEW_COLS, PREVIEW_SCALE, VIEW_ROWS } from './rendering/CanvasRenderer';
import { DEFAULT_SETTINGS, StorageManager, type Settings } from './storage/StorageManager';
import { UIManager, type Screen } from './ui/UIManager';

const storage = new StorageManager();
let settings: Settings = storage.loadSettings();
let best = storage.loadBest();

const ui = new UIManager();
const engine = new GameEngine();
const renderer = new CanvasRenderer(ui.fieldCanvas, ui.holdCanvas, ui.nextCanvas);
const audio = new AudioManager(settings);

let screen: Screen = 'title';
let settingsReturn: Screen = 'title';
let gameOverTimer: ReturnType<typeof setTimeout> | null = null;

// ---------- 入力 ----------

const target: InputTarget = {
  shift: (dx) => engine.shift(dx),
  shiftToWall: (dx) => engine.shiftToWall(dx),
  setSoftDrop: (on) => engine.setSoftDrop(on),
  hardDrop: () => engine.hardDrop(),
  rotate: (dir) => engine.rotate(dir),
  hold: () => engine.hold(),
  togglePause: () => togglePause(),
  toggleMute: () => toggleMute(),
  isPlaying: () => engine.state === 'playing' && screen === 'playing',
};
const input = new InputManager(target, { das: settings.das, arr: settings.arr });

window.addEventListener('keydown', (e) => {
  audio.ensure();
  if (screen === 'settings') {
    if (e.code === 'Escape') {
      e.preventDefault();
      closeSettings();
    }
    return;
  }
  if (screen === 'title' || screen === 'gameover') {
    if (e.code === 'Enter' || (screen === 'gameover' && e.code === 'KeyR')) {
      e.preventDefault();
      startGame();
    }
    return;
  }
  // プレイ中・ポーズ中だけゲーム操作とブラウザ既定動作の抑止を行う
  if (screen === 'paused' && e.code === 'Enter') return;
  if (input.keyDown(e.code)) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  if (input.keyUp(e.code) && (screen === 'playing' || screen === 'paused')) e.preventDefault();
});

ui.bindTouchButtons(
  (code) => {
    audio.ensure();
    input.keyDown(code);
  },
  (code) => input.keyUp(code),
);

// タブ切替・フォーカス喪失: 押下状態を破棄して自動ポーズ
function onFocusLost(): void {
  input.releaseAll();
  if (screen === 'playing' && engine.state === 'playing') pauseGame();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) onFocusLost();
  lastFrame = performance.now();
});
window.addEventListener('blur', onFocusLost);
window.addEventListener('pagehide', () => saveBestIfNeeded());

// ---------- 画面遷移 ----------

function startGame(): void {
  audio.ensure();
  if (gameOverTimer) clearTimeout(gameOverTimer);
  input.releaseAll();
  renderer.clearEffects();
  engine.start();
  audio.setLevel(1);
  audio.resume();
  audio.startBgm();
  screen = 'playing';
  ui.show('playing');
}

function pauseGame(): void {
  if (engine.state !== 'playing') return;
  engine.pause();
  audio.suspend();
  screen = 'paused';
  ui.show('paused');
}

function resumeGame(): void {
  if (engine.state !== 'paused') return;
  input.releaseAll();
  engine.resume();
  audio.resume();
  screen = 'playing';
  ui.show('playing');
  lastFrame = performance.now();
}

function togglePause(): void {
  if (screen === 'playing') pauseGame();
  else if (screen === 'paused') resumeGame();
}

function goTitle(): void {
  saveBestIfNeeded();
  if (gameOverTimer) clearTimeout(gameOverTimer);
  audio.stopBgm();
  audio.resume();
  input.releaseAll();
  engine.state = 'idle';
  screen = 'title';
  ui.show('title');
}

function openSettings(): void {
  settingsReturn = screen;
  ui.renderSettings(settings);
  screen = 'settings';
  ui.show('settings');
}

function closeSettings(): void {
  screen = settingsReturn;
  ui.show(screen);
}

function toggleMute(): void {
  applySettings({ ...settings, bgmMuted: !settings.bgmMuted });
  ui.toast(settings.bgmMuted ? 'BGM OFF' : 'BGM ON');
}

function saveBestIfNeeded(): boolean {
  if (engine.score > best) {
    best = engine.score;
    storage.saveBest(best);
    return true;
  }
  return false;
}

function onGameOver(): void {
  audio.stopBgm();
  const isBest = saveBestIfNeeded();
  ui.showResults(engine, isBest);
  // 演出用の短い間。入力はすでに無効（engine.state === 'over'）
  gameOverTimer = setTimeout(() => {
    if (engine.state !== 'over' || screen !== 'playing') return;
    screen = 'gameover';
    ui.show('gameover');
  }, 900);
}

ui.onAction((act) => {
  audio.ensure();
  switch (act) {
    case 'start':
    case 'restart':
      startGame();
      break;
    case 'resume':
      resumeGame();
      break;
    case 'toggle-pause':
      togglePause();
      break;
    case 'settings':
      openSettings();
      break;
    case 'close-settings':
      closeSettings();
      break;
    case 'reset-settings':
      applySettings({ ...DEFAULT_SETTINGS });
      ui.renderSettings(settings);
      break;
    case 'title':
      goTitle();
      break;
  }
});

// ---------- 設定 ----------

function applySettings(next: Settings): void {
  settings = next;
  input.das = next.das;
  input.arr = next.arr;
  audio.applySettings(next);
  storage.saveSettings(next);
  updateTouchMode();
}

ui.onSettingsChange((s) => applySettings(s));

const coarse = window.matchMedia?.('(pointer: coarse)');
function updateTouchMode(): void {
  const on = settings.touchControls === 'on' || (settings.touchControls === 'auto' && !!coarse?.matches);
  const changed = document.body.classList.contains('touch-on') !== on;
  document.body.classList.toggle('touch-on', on);
  if (changed) layout();
}

// ---------- ゲームイベント → 音・演出 ----------

let suppressNextLockSound = false;
engine.on((e: GameEvent) => {
  renderer.onEvent(e);
  switch (e.type) {
    case 'spawn':
      if (e.piece.isGiant) audio.play('giant');
      break;
    case 'move':
      audio.play('move');
      break;
    case 'rotate':
      audio.play('rotate');
      break;
    case 'hold':
      audio.play('hold');
      break;
    case 'hardDrop':
      audio.play('hardDrop');
      suppressNextLockSound = true;
      break;
    case 'lock':
      if (!suppressNextLockSound) audio.play('lock');
      suppressNextLockSound = false;
      break;
    case 'lineFlash':
      // 消去音は発光開始時に鳴らして入力への反応を遅らせない
      if (e.rows.length >= 5) audio.play('mega');
      else if (e.spin !== 'none') audio.play('tspin');
      else if (e.rows.length >= 4) audio.play('tetris');
      else audio.play('clear', e.rows.length);
      break;
    case 'action':
      if (e.perfectClear) audio.play('perfect');
      else if (e.rows.length === 0) audio.play('tspin'); // 0ライン T-Spin
      break;
    case 'levelUp':
      audio.play('levelUp');
      audio.setLevel(e.level);
      break;
    case 'gameOver':
      audio.play('gameOver');
      onGameOver();
      break;
  }
});

// ---------- レイアウト ----------

function layout(): void {
  const touch = document.body.classList.contains('touch-on');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const landscape = touch && vw > vh;
  document.body.classList.toggle('landscape', landscape);
  const touchEl = document.getElementById('touch')!;
  const touchH = touch && !landscape ? touchEl.offsetHeight || 190 : 0;
  const reservedW = landscape ? 2 * 200 : 0;
  const availH = vh - touchH - 24;
  const availW = vw - reservedW - 52;
  const byHeight = availH / (VIEW_ROWS + 0.6);
  // 幅: フィールド10セル + 左右パネル（プレビュー 9 単位）。縦長画面ではプレビューを縮めてフィールドを優先
  const fit = (scale: number) => availW / (BOARD_WIDTH + PREVIEW_COLS * scale * 2 + 0.8);
  const scale = fit(PREVIEW_SCALE) < byHeight * 0.85 ? 0.36 : PREVIEW_SCALE;
  const cell = Math.max(10, Math.min(40, Math.floor(Math.min(fit(scale), byHeight))));
  const unit = renderer.resize(cell, scale);
  const root = document.documentElement.style;
  root.setProperty('--cell', `${cell}px`);
  root.setProperty('--side-w', `${PREVIEW_COLS * unit + 14}px`);
  root.setProperty('--touch-h', `${touchH}px`);
}

window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 100));
coarse?.addEventListener?.('change', updateTouchMode);

// ---------- メインループ ----------

let lastFrame = performance.now();
function frame(now: number): void {
  const dt = Math.min(Math.max(now - lastFrame, 0), MAX_STEP_MS);
  lastFrame = now;
  if (screen === 'playing') {
    input.update(dt);
    engine.update(dt);
  }
  const effectsDt = screen === 'paused' || screen === 'settings' ? 0 : dt;
  renderer.render(engine, { ghost: settings.ghost }, effectsDt);
  ui.updateHud(engine, best);
  requestAnimationFrame(frame);
}

updateTouchMode();
layout();
ui.renderSettings(settings);
ui.show('title');
requestAnimationFrame(frame);

// 開発サーバーでのみデバッグ用にエンジンを公開
if (import.meta.env.DEV) (window as unknown as { __engine: GameEngine }).__engine = engine;

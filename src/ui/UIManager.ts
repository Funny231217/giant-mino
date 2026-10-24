import type { GameEngine } from '../core/GameEngine';
import { DEFAULT_SETTINGS, type Settings } from '../storage/StorageManager';

export type Screen = 'title' | 'playing' | 'paused' | 'gameover' | 'settings';

const OVERLAY_IDS: Partial<Record<Screen, string>> = {
  title: 'screen-title',
  paused: 'screen-paused',
  gameover: 'screen-gameover',
  settings: 'screen-settings',
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** DOM（メニュー・HUD・設定フォーム・タッチボタン）の管理。ゲームロジックは持たない。 */
export class UIManager {
  readonly fieldCanvas = $('field-canvas') as HTMLCanvasElement;
  readonly holdCanvas = $('hold-canvas') as HTMLCanvasElement;
  readonly nextCanvas = $('next-canvas') as HTMLCanvasElement;
  private readonly form = $('settings-form') as HTMLFormElement;
  private readonly hud = {
    level: $('hud-level'),
    score: $('hud-score'),
    combo: $('hud-combo'),
    giant: $('hud-giant'),
    giantBox: $('hud-giant-box'),
    lines: $('hud-lines'),
    best: $('hud-best'),
    time: $('hud-time'),
    b2b: $('b2b-badge'),
  };
  private lastText: Record<string, string> = {};
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  show(screen: Screen): void {
    for (const [name, id] of Object.entries(OVERLAY_IDS)) {
      $(id).classList.toggle('show', name === screen);
    }
    // ボタンにフォーカスを残さない（押しっぱなしの Space の keyup で誤って押されるのを防ぐ）
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  onAction(handler: (act: string) => void): void {
    document.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      el.addEventListener('click', () => handler(el.dataset.act!));
    });
    $('btn-touch-pause').addEventListener('click', () => handler('toggle-pause'));
  }

  private setText(key: keyof UIManager['hud'], text: string): void {
    if (this.lastText[key] === text) return;
    this.lastText[key] = text;
    this.hud[key].textContent = text;
  }

  updateHud(engine: GameEngine, best: number): void {
    this.setText('level', String(engine.level));
    this.setText('score', engine.score.toLocaleString('en-US'));
    this.setText('combo', engine.combo > 0 ? `${engine.combo}` : '—');
    const giantIn = engine.nextGiantIn();
    this.setText('giant', String(giantIn));
    this.hud.giantBox.classList.toggle('soon', giantIn <= 3);
    this.setText('lines', String(engine.lines));
    this.setText('best', Math.max(best, engine.score).toLocaleString('en-US'));
    this.setText('time', formatTime(engine.elapsedMs));
    this.hud.b2b.classList.toggle('on', engine.b2b && engine.state !== 'idle');
  }

  showResults(engine: GameEngine, isBest: boolean): void {
    $('go-score').textContent = engine.score.toLocaleString('en-US');
    $('go-lines').textContent = String(engine.lines);
    $('go-level').textContent = String(engine.level);
    $('go-time').textContent = formatTime(engine.elapsedMs);
    $('go-best').classList.toggle('show', isBest);
  }

  toast(text: string): void {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 1200);
  }

  // ---- 設定フォーム ----

  renderSettings(s: Settings): void {
    const f = this.form.elements;
    (f.namedItem('das') as HTMLInputElement).value = String(s.das);
    (f.namedItem('arr') as HTMLInputElement).value = String(s.arr);
    (f.namedItem('bgmVolume') as HTMLInputElement).value = String(Math.round(s.bgmVolume * 100));
    (f.namedItem('sfxVolume') as HTMLInputElement).value = String(Math.round(s.sfxVolume * 100));
    (f.namedItem('bgmMuted') as HTMLInputElement).checked = s.bgmMuted;
    (f.namedItem('sfxMuted') as HTMLInputElement).checked = s.sfxMuted;
    (f.namedItem('ghost') as HTMLInputElement).checked = s.ghost;
    (f.namedItem('touchControls') as HTMLSelectElement).value = s.touchControls;
    this.renderOutputs(s);
  }

  private renderOutputs(s: Settings): void {
    const out = (name: string, text: string) => {
      const el = this.form.querySelector(`output[data-for="${name}"]`);
      if (el) el.textContent = text;
    };
    out('das', `${s.das} ms`);
    out('arr', `${s.arr} ms`);
    out('bgmVolume', `${Math.round(s.bgmVolume * 100)}%`);
    out('sfxVolume', `${Math.round(s.sfxVolume * 100)}%`);
  }

  readSettings(): Settings {
    const f = this.form.elements;
    const n = (name: string) => Number((f.namedItem(name) as HTMLInputElement).value);
    const b = (name: string) => (f.namedItem(name) as HTMLInputElement).checked;
    const touch = (f.namedItem('touchControls') as HTMLSelectElement).value;
    return {
      das: n('das'),
      arr: n('arr'),
      bgmVolume: n('bgmVolume') / 100,
      sfxVolume: n('sfxVolume') / 100,
      bgmMuted: b('bgmMuted'),
      sfxMuted: b('sfxMuted'),
      ghost: b('ghost'),
      touchControls: touch === 'on' || touch === 'off' ? touch : DEFAULT_SETTINGS.touchControls,
    };
  }

  onSettingsChange(handler: (s: Settings) => void): void {
    const fire = () => {
      const s = this.readSettings();
      this.renderOutputs(s);
      handler(s);
    };
    this.form.addEventListener('input', fire);
    this.form.addEventListener('change', fire);
  }

  // ---- タッチボタン ----

  bindTouchButtons(down: (code: string) => void, up: (code: string) => void): void {
    document.querySelectorAll<HTMLButtonElement>('[data-code]').forEach((btn) => {
      const code = btn.dataset.code!;
      let pointer: number | null = null;
      const release = (e: PointerEvent) => {
        if (pointer !== e.pointerId) return;
        pointer = null;
        btn.classList.remove('pressed');
        up(code);
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (pointer !== null) return;
        pointer = e.pointerId;
        btn.setPointerCapture?.(e.pointerId);
        btn.classList.add('pressed');
        down(code);
      });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }
}

export type TouchMode = 'auto' | 'on' | 'off';

export interface Settings {
  das: number;
  arr: number;
  bgmVolume: number;
  sfxVolume: number;
  bgmMuted: boolean;
  sfxMuted: boolean;
  ghost: boolean;
  touchControls: TouchMode;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  das: 150,
  arr: 30,
  bgmVolume: 0.6,
  sfxVolume: 0.8,
  bgmMuted: false,
  sfxMuted: false,
  ghost: true,
  touchControls: 'auto',
};

export const LIMITS = {
  das: { min: 0, max: 400 },
  arr: { min: 0, max: 100 },
} as const;

const SETTINGS_KEY = 'giant-mino.settings.v1';
const BEST_KEY = 'giant-mino.best.v1';

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** 破損・型違いの値は項目ごとに初期値へ戻す。 */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    das: num(r.das, LIMITS.das.min, LIMITS.das.max, d.das),
    arr: num(r.arr, LIMITS.arr.min, LIMITS.arr.max, d.arr),
    bgmVolume: num(r.bgmVolume, 0, 1, d.bgmVolume),
    sfxVolume: num(r.sfxVolume, 0, 1, d.sfxVolume),
    bgmMuted: bool(r.bgmMuted, d.bgmMuted),
    sfxMuted: bool(r.sfxMuted, d.sfxMuted),
    ghost: bool(r.ghost, d.ghost),
    touchControls: r.touchControls === 'on' || r.touchControls === 'off' ? r.touchControls : 'auto',
  };
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class StorageManager {
  constructor(private readonly storage: KV | null = defaultStorage()) {}

  loadSettings(): Settings {
    try {
      const text = this.storage?.getItem(SETTINGS_KEY);
      return sanitizeSettings(text ? JSON.parse(text) : null);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings(s: Settings): void {
    try {
      this.storage?.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      /* 保存できない環境でもゲームは続行 */
    }
  }

  loadBest(): number {
    try {
      const v = Number(this.storage?.getItem(BEST_KEY) ?? 0);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch {
      return 0;
    }
  }

  saveBest(score: number): void {
    try {
      this.storage?.setItem(BEST_KEY, String(Math.floor(score)));
    } catch {
      /* ignore */
    }
  }
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, StorageManager, sanitizeSettings } from '../storage/StorageManager';

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('設定・データ保存', () => {
  it('保存した設定と最高スコアを読み戻せる', () => {
    const kv = memory();
    const s = new StorageManager(kv);
    s.saveSettings({ ...DEFAULT_SETTINGS, das: 100, arr: 0, ghost: false, bgmMuted: true });
    s.saveBest(12345);
    expect(s.loadSettings()).toMatchObject({ das: 100, arr: 0, ghost: false, bgmMuted: true });
    expect(s.loadBest()).toBe(12345);
  });

  it('壊れた JSON・型違い・範囲外は初期値へフォールバック', () => {
    expect(new StorageManager(memory({ 'giant-mino.settings.v1': '{oops' })).loadSettings()).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({ das: 'fast', arr: 9999, bgmVolume: -1, ghost: 'yes', touchControls: 'maybe' });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, arr: 100, bgmVolume: 0 });
  });

  it('localStorage が使えない環境でも例外を出さない', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    const s = new StorageManager(throwing);
    expect(s.loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(s.loadBest()).toBe(0);
    expect(() => s.saveBest(1)).not.toThrow();
    expect(new StorageManager(null).loadBest()).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_RENDER_QUALITY } from '../src/lib/render-quality';
import { loadRenderQuality, RENDER_QUALITY_STORAGE_KEY, saveRenderQuality } from '../src/lib/render-quality-storage';

describe('browser-local render quality', () => {
  it.each(['fast', 'balanced', 'smooth'] as const)('remembers %s across loads', quality => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    saveRenderQuality(quality, storage);
    expect(values.get(RENDER_QUALITY_STORAGE_KEY)).toBe(quality);
    expect(loadRenderQuality(storage)).toBe(quality);
  });

  it('defaults to fast rendering for a new browser or invalid stored value', () => {
    expect(DEFAULT_RENDER_QUALITY).toBe('fast');
    for (const value of [null, '', 'high', '3', '{broken']) {
      expect(loadRenderQuality({ getItem: () => value })).toBe('fast');
    }
  });

  it('keeps rendering usable with blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('Denied'); }, setItem: () => { throw new Error('Denied'); } };
    expect(loadRenderQuality(blocked)).toBe('fast');
    expect(() => saveRenderQuality('fast', blocked)).not.toThrow();
  });
});

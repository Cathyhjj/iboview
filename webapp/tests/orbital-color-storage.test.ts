import { describe, expect, it } from 'vitest';
import { DEFAULT_ORBITAL_COLORS, type OrbitalColors } from '../src/lib/orbital-colors';
import { loadOrbitalColors, ORBITAL_COLORS_STORAGE_KEY, saveOrbitalColors } from '../src/lib/orbital-color-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const storedJSON = (value: string | null) => ({ getItem: () => value });

describe('orbital color preferences', () => {
  it.each(['plasma', 'custom'] as const)('restores all saved %s settings on a later load', palette => {
    const storage = memoryStorage();
    const colors: OrbitalColors = {
      ...DEFAULT_ORBITAL_COLORS, palette, reversed: true, vmin: 0.18, vmax: 0.74,
      positiveColor: '#123456', negativeColor: '#abcdef', gradientExtent: 0.67, gradientStrength: 1.83,
    };
    saveOrbitalColors(colors, storage);
    expect(ORBITAL_COLORS_STORAGE_KEY).toBe('iboview-orbital-colors-v1');
    expect(JSON.parse(storage.getItem(ORBITAL_COLORS_STORAGE_KEY)!)).toEqual(colors);
    expect(loadOrbitalColors(storage)).toEqual(colors);
  });

  it('uses defaults when no preference has been saved', () => {
    expect(loadOrbitalColors(memoryStorage())).toEqual(DEFAULT_ORBITAL_COLORS);
  });

  it('fills missing fields in an older partial preference without discarding valid choices', () => {
    const stored = { palette: 'viridis', reversed: true, gradientStrength: 1.4 };
    expect(loadOrbitalColors(storedJSON(JSON.stringify(stored))))
      .toEqual({ ...DEFAULT_ORBITAL_COLORS, ...stored });
  });

  it.each(['{broken', 'null', '[]', '42', 'true', '"plasma"', '{}'])('handles invalid or empty saved JSON %s', raw => {
    expect(loadOrbitalColors(storedJSON(raw))).toEqual(DEFAULT_ORBITAL_COLORS);
  });

  it('defaults invalid fields individually while retaining valid custom colors and settings', () => {
    const raw = JSON.stringify({
      palette: 'unknown-map', reversed: 'true', vmin: '0.25', vmax: null,
      positiveColor: 'red', negativeColor: '#abcdef', gradientExtent: 0.57, gradientStrength: '2',
    });
    expect(loadOrbitalColors(storedJSON(raw))).toEqual({
      ...DEFAULT_ORBITAL_COLORS, negativeColor: '#abcdef', gradientExtent: 0.57,
    });
  });

  it('rejects nonfinite numbers rather than treating them as valid slider limits', () => {
    const raw = '{"palette":"plasma","vmin":1e999,"vmax":-1e999,"gradientExtent":1e999,"gradientStrength":-1e999}';
    expect(loadOrbitalColors(storedJSON(raw))).toEqual({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' });
  });

  it('clamps finite values to the supported ranges', () => {
    const raw = JSON.stringify({ palette: 'magma', vmin: -0.4, vmax: 1.6, gradientExtent: -0.5, gradientStrength: 7 });
    expect(loadOrbitalColors(storedJSON(raw))).toEqual({
      ...DEFAULT_ORBITAL_COLORS, palette: 'magma', vmin: 0, vmax: 1, gradientExtent: 0, gradientStrength: 2,
    });
    const opposite = JSON.stringify({ gradientExtent: 4, gradientStrength: -3 });
    expect(loadOrbitalColors(storedJSON(opposite)))
      .toEqual({ ...DEFAULT_ORBITAL_COLORS, gradientExtent: 1, gradientStrength: 0 });
  });

  it.each([
    [0.5, 0.5, 0.5, 0.52],
    [0.99, 0.2, 0.98, 1],
  ])('normalizes overlapping saved cmap bounds %s and %s', (vmin, vmax, lower, upper) => {
    const colors = loadOrbitalColors(storedJSON(JSON.stringify({ palette: 'plasma', vmin, vmax })));
    expect(colors.vmin).toBeCloseTo(lower);
    expect(colors.vmax).toBeCloseTo(upper);
    expect(colors.palette).toBe('plasma');
  });

  it('keeps defaults usable when reading storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('Storage access denied'); } };
    expect(loadOrbitalColors(blocked)).toEqual(DEFAULT_ORBITAL_COLORS);
  });

  it('does not interrupt color changes when storage cannot be written', () => {
    const blocked = { setItem: () => { throw new Error('Storage quota exceeded'); } };
    expect(() => saveOrbitalColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' }, blocked)).not.toThrow();
  });

  it('works when browser storage is unavailable', () => {
    expect(loadOrbitalColors()).toEqual(DEFAULT_ORBITAL_COLORS);
    expect(() => saveOrbitalColors(DEFAULT_ORBITAL_COLORS)).not.toThrow();
  });

  it('persists reset defaults over a previously saved gradient preference', () => {
    const storage = memoryStorage();
    saveOrbitalColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'inferno', reversed: true,
      vmin: 0.2, vmax: 0.8, gradientExtent: 0.9, gradientStrength: 2 }, storage);
    saveOrbitalColors({ ...DEFAULT_ORBITAL_COLORS }, storage);
    expect(loadOrbitalColors(storage)).toEqual(DEFAULT_ORBITAL_COLORS);
    expect(loadOrbitalColors(storage).gradientExtent).toBe(0.2);
    expect(loadOrbitalColors(storage).gradientStrength).toBe(1);
  });
});

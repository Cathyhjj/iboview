import { describe, expect, it } from 'vitest';
import { cameraKeyForStructure } from '../src/lib/camera-storage';
import {
  loadOrbitalSurfacePreferences, ORBITAL_SURFACES_STORAGE_KEY,
  restoreOrbitalSurfacePreferences, saveOrbitalSurfacePreferences, type OrbitalSurfacePreferences,
} from '../src/lib/orbital-surface-storage';

const keyFor = (x: number) => cameraKeyForStructure([{ element: 'C', x, y: 0, z: 0 }]);
const fallback: OrbitalSurfacePreferences = { isovalue: 0.045, surface: true };
const range = { min: 0.015, max: 0.12 };

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('per-molecule orbital surface preferences', () => {
  it('uses geometry keys to restore independent settings, including false and small isovalues', () => {
    const storage = memoryStorage();
    const first = { isovalue: 0.000000123456, surface: false };
    const second = { isovalue: 0.0835, surface: true };
    saveOrbitalSurfacePreferences(keyFor(0), first, storage);
    saveOrbitalSurfacePreferences(keyFor(1), second, storage);
    expect(ORBITAL_SURFACES_STORAGE_KEY).toBe('iboview-orbital-surfaces-v1');
    expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(first);
    expect(loadOrbitalSurfacePreferences(keyFor(1), storage)).toEqual(second);
    expect(loadOrbitalSurfacePreferences(keyFor(2), storage)).toBeUndefined();
    const loaded = loadOrbitalSurfacePreferences(keyFor(0), storage)!;
    loaded.surface = true;
    expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(first);
  });

  it('stores only the two surface preference fields', () => {
    const storage = memoryStorage();
    const settings = { ...fallback, opacity: 0.8, material: 'soft', cube: 'private file data' };
    saveOrbitalSurfacePreferences(keyFor(0), settings, storage);
    expect(JSON.parse(storage.getItem(ORBITAL_SURFACES_STORAGE_KEY)!))
      .toEqual([{ key: keyFor(0), preferences: fallback }]);
  });

  it('keeps the 32 most recently updated molecules and replaces duplicate records', () => {
    const storage = memoryStorage();
    for (let index = 0; index < 32; index++) saveOrbitalSurfacePreferences(keyFor(index), fallback, storage);
    const updated = { isovalue: 0.07125, surface: false };
    saveOrbitalSurfacePreferences(keyFor(0), updated, storage);
    saveOrbitalSurfacePreferences(keyFor(32), fallback, storage);
    const records = JSON.parse(storage.getItem(ORBITAL_SURFACES_STORAGE_KEY)!);
    expect(records).toHaveLength(32);
    expect(records.filter((item: { key: string }) => item.key === keyFor(0))).toHaveLength(1);
    expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(updated);
    expect(loadOrbitalSurfacePreferences(keyFor(1), storage)).toBeUndefined();
    expect(loadOrbitalSurfacePreferences(keyFor(2), storage)).toEqual(fallback);
    expect(loadOrbitalSurfacePreferences(keyFor(32), storage)).toEqual(fallback);
  });

  it.each(['{broken', 'null', '{}', '[]', '[null,42,{"key":"wrong"}]'])
    ('recovers from corrupted or empty storage %s', raw => {
      const storage = memoryStorage();
      storage.setItem(ORBITAL_SURFACES_STORAGE_KEY, raw);
      expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toBeUndefined();
      saveOrbitalSurfacePreferences(keyFor(0), fallback, storage);
      expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(fallback);
    });

  it.each([
    { isovalue: 0, surface: true }, { isovalue: -1, surface: true },
    { isovalue: Infinity, surface: true }, { isovalue: NaN, surface: true },
    { isovalue: '0.04', surface: true }, { isovalue: 0.04, surface: 'false' },
    { isovalue: 0.04 }, { surface: false },
  ])('rejects invalid preference records %j without replacing an existing value', invalid => {
    const storage = memoryStorage();
    saveOrbitalSurfacePreferences(keyFor(0), fallback, storage);
    saveOrbitalSurfacePreferences(keyFor(0), invalid as OrbitalSurfacePreferences, storage);
    expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(fallback);
    storage.setItem(ORBITAL_SURFACES_STORAGE_KEY, JSON.stringify([{ key: keyFor(1), preferences: invalid },
      { key: keyFor(0), preferences: fallback }]));
    expect(loadOrbitalSurfacePreferences(keyFor(1), storage)).toBeUndefined();
    expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(fallback);
  });

  it.each(['benzene', 'geometry-123', 'geometry-ABCDEF0123456789', 'geometry-000000000000000g'])
    ('rejects a non-geometry key %s', key => {
      const storage = memoryStorage();
      saveOrbitalSurfacePreferences(key, fallback, storage);
      expect(storage.getItem(ORBITAL_SURFACES_STORAGE_KEY)).toBeNull();
      expect(loadOrbitalSurfacePreferences(key, storage)).toBeUndefined();
    });

  it('takes the newest valid record when damaged storage contains duplicate keys', () => {
    const storage = memoryStorage();
    const latest = { isovalue: 0.078, surface: false };
    storage.setItem(ORBITAL_SURFACES_STORAGE_KEY, JSON.stringify([
      { key: keyFor(0), preferences: fallback }, { key: keyFor(0), preferences: latest },
    ]));
    expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(latest);
  });

  it('tolerates blocked reads, failed writes, and unavailable browser storage', () => {
    const readBlocked = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    const writeBlocked = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(loadOrbitalSurfacePreferences(keyFor(0), readBlocked)).toBeUndefined();
    expect(() => saveOrbitalSurfacePreferences(keyFor(0), fallback, readBlocked)).not.toThrow();
    expect(() => saveOrbitalSurfacePreferences(keyFor(0), fallback, writeBlocked)).not.toThrow();
    expect(loadOrbitalSurfacePreferences(keyFor(0))).toBeUndefined();
    expect(() => saveOrbitalSurfacePreferences(keyFor(0), fallback)).not.toThrow();
  });
});

describe('surface restoration for the current slider range', () => {
  it.each([[0.00012, 0.015], [0.073125, 0.073125], [0.9, 0.12]])
    ('clamps isovalue %s to %s while preserving the surface toggle and saved value', (isovalue, expected) => {
      const storage = memoryStorage();
      const saved = { isovalue, surface: false };
      saveOrbitalSurfacePreferences(keyFor(0), saved, storage);
      const raw = storage.getItem(ORBITAL_SURFACES_STORAGE_KEY);
      const restored = restoreOrbitalSurfacePreferences(loadOrbitalSurfacePreferences(keyFor(0), storage), fallback, range);
      expect(restored).toEqual({ isovalue: expected, surface: false });
      expect(saved).toEqual({ isovalue, surface: false });
      expect(storage.getItem(ORBITAL_SURFACES_STORAGE_KEY)).toBe(raw);
      expect(loadOrbitalSurfacePreferences(keyFor(0), storage)).toEqual(saved);
    });

  it.each([undefined, null, {}, { isovalue: 0, surface: false }, { isovalue: 0.06, surface: 'false' }])
    ('uses the complete fallback when saved preferences are invalid: %j', saved => {
      expect(restoreOrbitalSurfacePreferences(saved, fallback, range)).toEqual(fallback);
    });

  it('also bounds a fallback without mutating it', () => {
    const defaults = { isovalue: 0.045, surface: false };
    expect(restoreOrbitalSurfacePreferences(undefined, defaults, { min: 0.001, max: 0.01 }))
      .toEqual({ isovalue: 0.01, surface: false });
    expect(defaults).toEqual({ isovalue: 0.045, surface: false });
  });
});

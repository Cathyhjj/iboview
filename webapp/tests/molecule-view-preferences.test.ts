import { describe, expect, it } from 'vitest';
import type { DisplaySettings } from '../src/types';
import { cameraKeyForStructure } from '../src/lib/camera-storage';
import { DEFAULT_MOLECULE_APPEARANCE } from '../src/lib/molecule-appearance';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors, type OrbitalColors } from '../src/lib/orbital-colors';
import {
  applyMoleculeViewPreferences, loadMoleculeViewPreferences, MOLECULE_VIEW_PREFERENCES_STORAGE_KEY,
  moleculeViewPreferences, saveMoleculeViewPreferences, type MoleculeViewPreferences,
} from '../src/lib/molecule-view-preferences';

const settings: DisplaySettings = {
  ...DEFAULT_MOLECULE_APPEARANCE, opacity: 0.55, material: 'extra',
  isovalue: 0.045, surface: true, spinning: false, ...orbitalPhaseColors(DEFAULT_ORBITAL_COLORS),
};
const keyFor = (x: number) => cameraKeyForStructure([{ element: 'C', x, y: 0, z: 0 }]);
const snapshot = () => moleculeViewPreferences(settings, DEFAULT_ORBITAL_COLORS);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('per-molecule view preferences', () => {
  it('restores A after viewing B and merges updates without overwriting B', () => {
    const storage = memoryStorage();
    const first = moleculeViewPreferences({ ...settings, style: 'wireframe', opacity: 0.15, material: 'soft' },
      { ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', reversed: true, vmin: 0.2, vmax: 0.8,
        gradientExtent: 0.65, gradientStrength: 1.7 });
    const second = moleculeViewPreferences({ ...settings, style: 'space-fill', opacity: 0.9, material: 'shiny' },
      { ...DEFAULT_ORBITAL_COLORS, palette: 'custom', positiveColor: '#123456', negativeColor: '#abcdef' });
    saveMoleculeViewPreferences(keyFor(0), first, storage);
    saveMoleculeViewPreferences(keyFor(1), second, storage);
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(first);
    expect(loadMoleculeViewPreferences(keyFor(1), storage)).toEqual(second);
    const updated = { ...first, opacity: 0.3 };
    saveMoleculeViewPreferences(keyFor(0), updated, storage);
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(updated);
    expect(loadMoleculeViewPreferences(keyFor(1), storage)).toEqual(second);
    expect(JSON.parse(storage.getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY)!)).toHaveLength(2);
  });

  it('preserves false values, zero opacity and gradient controls, and custom colors', () => {
    const storage = memoryStorage();
    const value = moleculeViewPreferences({ ...settings, hydrogens: false, labels: false, bonds: false,
      opacity: 0, elementColors: { C: '#123456', H: '#abcdef' } },
    { ...DEFAULT_ORBITAL_COLORS, palette: 'custom', reversed: false, gradientExtent: 0, gradientStrength: 0,
      positiveColor: '#112233', negativeColor: '#aabbcc' });
    saveMoleculeViewPreferences(keyFor(0), value, storage);
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(value);
    expect(value.appearance).toMatchObject({ hydrogens: false, labels: false, bonds: false });
    expect(value.colors).toMatchObject({ gradientExtent: 0, gradientStrength: 0, positiveColor: '#112233', negativeColor: '#aabbcc' });
    expect(value.opacity).toBe(0);
  });

  it('stores only visual preferences, excluding camera, theme, scientific values and file data', () => {
    const storage = memoryStorage();
    const source = { ...settings, theme: 'dark', camera: { pan: [1, 2] }, cube: 'private file data',
      orbitalGradient: { positive: ['#123456'], negative: ['#abcdef'] } };
    const colors = { ...DEFAULT_ORBITAL_COLORS, fileName: 'private.cube' };
    const value = moleculeViewPreferences(source, colors);
    const extra = { ...value, isovalue: 0.12, surface: false, spinning: true, source: 'private data' };
    saveMoleculeViewPreferences(keyFor(0), extra, storage);
    expect(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY).toBe('iboview-molecule-view-preferences-v1');
    expect(Object.keys(value).sort()).toEqual(['appearance', 'colors', 'material', 'opacity']);
    expect(value.appearance).toEqual(DEFAULT_MOLECULE_APPEARANCE);
    expect(value.colors).toEqual(DEFAULT_ORBITAL_COLORS);
    expect(JSON.parse(storage.getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY)!))
      .toEqual([{ key: keyFor(0), preferences: value }]);
    expect(storage.getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY)).not.toMatch(/private|isovalue|surface|spinning|theme|camera|orbitalGradient/);
  });

  it('returns independent copies of saved and normalized nested preferences', () => {
    const storage = memoryStorage();
    const source = { ...settings, elementColors: { C: '#123456' } };
    const colors = { ...DEFAULT_ORBITAL_COLORS, palette: 'custom' as const, positiveColor: '#112233' };
    const value = moleculeViewPreferences(source, colors);
    source.elementColors.C = '#ffffff';
    colors.positiveColor = '#000000';
    expect(value.appearance.elementColors.C).toBe('#123456');
    expect(value.colors.positiveColor).toBe('#112233');
    saveMoleculeViewPreferences(keyFor(0), value, storage);
    const loaded = loadMoleculeViewPreferences(keyFor(0), storage)!;
    loaded.appearance.elementColors.C = '#abcdef';
    loaded.colors.positiveColor = '#fedcba';
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(value);
  });

  it('defaults invalid internal fields and clamps supported ranges without discarding valid fields', () => {
    const storage = memoryStorage();
    storage.setItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify([{ key: keyFor(0), preferences: {
      appearance: { style: 'bad', hydrogens: false, labels: true, atomScale: 50, bondScale: -4,
        atomColor: 'red', atomMaterial: 'soft', elementColors: { C: '#123456', O: 'bad' } },
      colors: { palette: 'plasma', reversed: true, vmin: -3, vmax: 5, gradientExtent: 7,
        gradientStrength: -1, positiveColor: '#abcdef', negativeColor: 'bad' },
      opacity: 2, material: 'bad',
    } }]));
    const value = loadMoleculeViewPreferences(keyFor(0), storage)!;
    expect(value.appearance).toMatchObject({ style: 'ball-stick', hydrogens: false, labels: true,
      atomScale: 2, bondScale: 0.25, atomColor: DEFAULT_MOLECULE_APPEARANCE.atomColor,
      atomMaterial: 'soft', elementColors: { C: '#123456' } });
    expect(value.colors).toEqual({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', reversed: true,
      gradientExtent: 1, gradientStrength: 0, positiveColor: '#abcdef' });
    expect(value.opacity).toBe(1);
    expect(value.material).toBe('extra');
  });

  it.each([[-1, 0], [0, 0], [0.1, 0.1], [1.2, 1], [NaN, 0.55], [Infinity, 0.55]])
    ('normalizes opacity %s to %s without enforcing the slider minimum', (opacity, expected) => {
      expect(moleculeViewPreferences({ ...settings, opacity }, DEFAULT_ORBITAL_COLORS).opacity).toBe(expected);
    });

  it('allows internal missing fields in otherwise complete records to use defaults', () => {
    const storage = memoryStorage();
    storage.setItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify([{ key: keyFor(0),
      preferences: { appearance: {}, colors: {}, opacity: null, material: null } }]));
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(snapshot());
  });

  it('returns undefined for absent records rather than a global default', () => {
    const storage = memoryStorage();
    saveMoleculeViewPreferences(keyFor(0), snapshot(), storage);
    expect(loadMoleculeViewPreferences(keyFor(1), storage)).toBeUndefined();
  });

  it.each(['{broken', 'null', '{}', '[]', '42', '[null,42,{"key":"wrong"}]'])
    ('handles corrupted top-level storage %s and permits subsequent recovery', raw => {
      const storage = memoryStorage();
      storage.setItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY, raw);
      expect(loadMoleculeViewPreferences(keyFor(0), storage)).toBeUndefined();
      saveMoleculeViewPreferences(keyFor(0), snapshot(), storage);
      expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(snapshot());
    });

  it.each([
    {}, { appearance: {}, colors: {}, opacity: 0.5 }, { appearance: {}, colors: {}, material: 'soft' },
    { appearance: [], colors: {}, opacity: 0.5, material: 'soft' },
    { appearance: {}, colors: null, opacity: 0.5, material: 'soft' },
  ])('ignores incomplete or structurally invalid records %j', invalid => {
    const storage = memoryStorage();
    storage.setItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify([
      { key: keyFor(0), preferences: invalid }, { key: keyFor(1), preferences: snapshot() },
    ]));
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toBeUndefined();
    expect(loadMoleculeViewPreferences(keyFor(1), storage)).toEqual(snapshot());
    saveMoleculeViewPreferences(keyFor(1), invalid as MoleculeViewPreferences, storage);
    expect(loadMoleculeViewPreferences(keyFor(1), storage)).toEqual(snapshot());
  });

  it.each(['benzene', 'geometry-short', 'geometry-ABCDEF0123456789', 'geometry-000000000000000g'])
    ('does not accept a non-geometry key %s', key => {
      const storage = memoryStorage();
      saveMoleculeViewPreferences(key, snapshot(), storage);
      expect(storage.getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY)).toBeNull();
      expect(loadMoleculeViewPreferences(key, storage)).toBeUndefined();
    });

  it('keeps the 128 most recently updated geometries', () => {
    const storage = memoryStorage();
    const value = snapshot();
    for (let index = 0; index < 128; index++) saveMoleculeViewPreferences(keyFor(index), value, storage);
    const updated = { ...value, opacity: 0.12 };
    saveMoleculeViewPreferences(keyFor(0), updated, storage);
    saveMoleculeViewPreferences(keyFor(128), value, storage);
    expect(JSON.parse(storage.getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY)!)).toHaveLength(128);
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(updated);
    expect(loadMoleculeViewPreferences(keyFor(1), storage)).toBeUndefined();
    expect(loadMoleculeViewPreferences(keyFor(128), storage)).toEqual(value);
  });

  it('uses the newest valid duplicate and tolerates blocked storage', () => {
    const storage = memoryStorage();
    const updated = { ...snapshot(), opacity: 0.12 };
    storage.setItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify([
      { key: keyFor(0), preferences: snapshot() }, { key: keyFor(0), preferences: updated },
    ]));
    expect(loadMoleculeViewPreferences(keyFor(0), storage)).toEqual(updated);
    const readBlocked = { getItem: () => { throw new Error('denied'); }, setItem: () => {} };
    const writeBlocked = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(loadMoleculeViewPreferences(keyFor(0), readBlocked)).toBeUndefined();
    expect(() => saveMoleculeViewPreferences(keyFor(0), snapshot(), readBlocked)).not.toThrow();
    expect(() => saveMoleculeViewPreferences(keyFor(0), snapshot(), writeBlocked)).not.toThrow();
    expect(loadMoleculeViewPreferences(keyFor(0))).toBeUndefined();
    expect(() => saveMoleculeViewPreferences(keyFor(0), snapshot())).not.toThrow();
  });
});

describe('merging a molecule view into current display settings', () => {
  it('restores appearance and derived phase colors while preserving surface, isovalue and animation', () => {
    const current = { ...settings, isovalue: 0.073125, surface: false, spinning: true };
    const colors: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', reversed: true,
      vmin: 0.2, vmax: 0.8, gradientExtent: 0.65, gradientStrength: 1.5 };
    const preferences = moleculeViewPreferences({ ...settings, style: 'spheres', opacity: 0.1,
      material: 'soft', atomMaterial: 'shiny', elementColors: { C: '#123456' } }, colors);
    const result = applyMoleculeViewPreferences(current, preferences);
    expect(result).toMatchObject({ isovalue: 0.073125, surface: false, spinning: true,
      style: 'spheres', opacity: 0.1, material: 'soft', atomMaterial: 'shiny', ...orbitalPhaseColors(colors) });
    expect(result).not.toBe(current);
    expect(current.style).toBe(settings.style);
    expect(current.opacity).toBe(0.55);
    result.elementColors.C = '#ffffff';
    expect(preferences.appearance.elementColors.C).toBe('#123456');
  });

  it.each(['iboview', 'classic', 'colorblind', 'custom'] as const)('removes the previous gradient when restoring %s', palette => {
    const current: DisplaySettings = { ...settings,
      ...orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' }) };
    const colors: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette,
      positiveColor: '#123456', negativeColor: '#abcdef' };
    const result = applyMoleculeViewPreferences(current, moleculeViewPreferences(settings, colors));
    expect(result).not.toHaveProperty('orbitalGradient');
    expect(result).toMatchObject(orbitalPhaseColors(colors));
    expect(current.orbitalGradient).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_MOLECULE_APPEARANCE, elementDisplayColor, MOLECULE_PRESETS, normalizeMoleculeAppearance } from '../src/lib/molecule-appearance';

describe('molecular appearance preferences', () => {
  it('preserves all preset fields through a JSON save and reload', () => {
    for (const preset of MOLECULE_PRESETS) {
      expect(normalizeMoleculeAppearance(JSON.parse(JSON.stringify(preset.settings)))).toEqual(preset.settings);
    }
  });

  it('keeps invalid and stale storage from introducing bad colors or unbounded geometry', () => {
    const result = normalizeMoleculeAppearance({ atomScale: Infinity, hydrogenScale: -5, bondScale: 100,
      style: 'cartoon', labels: 'true', atomColor: 'bad', bondColorMode: 'gradient',
      elementColors: { C: '#123456', O: 'red', '#bad': '#112233' }, isovalue: 500, surface: false });
    expect(result.atomScale).toBe(DEFAULT_MOLECULE_APPEARANCE.atomScale);
    expect(result.hydrogenScale).toBe(.4);
    expect(result.bondScale).toBe(2);
    expect(result.style).toBe('ball-stick');
    expect(result.labels).toBe(false);
    expect(result.atomColor).toBe(DEFAULT_MOLECULE_APPEARANCE.atomColor);
    expect(result.bondColorMode).toBe('element');
    expect(result.elementColors).toEqual({ C: '#123456' });
    expect(result).not.toHaveProperty('isovalue');
    expect(result).not.toHaveProperty('surface');
    expect(normalizeMoleculeAppearance(null)).toEqual(DEFAULT_MOLECULE_APPEARANCE);
  });

  it('shows the native element colors and respects explicit overrides', () => {
    const base = DEFAULT_MOLECULE_APPEARANCE;
    expect(elementDisplayColor('C', base)).toBe('#999999');
    expect(elementDisplayColor('H', base)).toBe('#ffffff');
    expect(elementDisplayColor('O', base)).toBe('#ff0000');
    expect(elementDisplayColor('C', { ...base, atomPalette: 'uniform', atomColor: '#123456' })).toBe('#123456');
    expect(elementDisplayColor('C', { ...base, atomPalette: 'studio', elementColors: { C: '#abcdef' } })).toBe('#abcdef');
  });
});

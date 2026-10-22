import { describe, expect, it } from 'vitest';
import type { DisplaySettings } from '../src/types';
import { DEFAULT_MOLECULE_APPEARANCE } from '../src/lib/molecule-appearance';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors, type OrbitalColors } from '../src/lib/orbital-colors';
import { CONFIG_EXTENSION, MAX_CONFIG_BYTES, applyAppearanceConfig, configFileName, parseAppearanceConfig, serializeAppearanceConfig } from '../src/lib/appearance-config';

const colors: OrbitalColors = {
  ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', reversed: true,
  vmin: 0.14, vmax: 0.82, gradientExtent: 0.73, gradientStrength: 1.7,
};
const settings: DisplaySettings = {
  ...DEFAULT_MOLECULE_APPEARANCE, style: 'wireframe', hydrogens: false, labels: true,
  atomScale: 1.4, hydrogenScale: 0.7, bondScale: 0.35, bonds: false,
  atomPalette: 'uniform', atomColor: '#abcdef', elementColors: { C: '#123456', Re: '#654321' },
  bondStyle: 'cylinder', bondColorMode: 'uniform', bondColor: '#fedcba', atomMaterial: 'shiny',
  isovalue: 0.026, opacity: 0.76, surface: false, spinning: true, material: 'soft',
  ...orbitalPhaseColors(colors),
};
const snapshot = { settings, colors, theme: 'dark' as const };
const stored = () => JSON.parse(serializeAppearanceConfig(snapshot));

describe('reusable appearance config', () => {
  it.each(['custom', 'plasma'] as const)('round trips %s colors and all molecular appearance independently of a project', palette => {
    const original = { ...snapshot, colors: { ...colors, palette, positiveColor: '#123AbC', negativeColor: '#987dEF' } };
    const text = serializeAppearanceConfig(original);
    const config = parseAppearanceConfig(text);
    expect(config.colors).toEqual(original.colors);
    expect(config.appearance.elementColors).toEqual({ C: '#123456', Re: '#654321' });
    expect(config).toMatchObject({ opacity: settings.opacity, material: settings.material, theme: 'dark' });
    expect(applyAppearanceConfig(settings, config)).toEqual({ ...settings, ...orbitalPhaseColors(original.colors),
      ...(palette === 'custom' ? { orbitalGradient: undefined } : {}) });
    expect(serializeAppearanceConfig({ settings: applyAppearanceConfig(settings, config), colors: config.colors, theme: config.theme })).toBe(text);
  });

  it('exports only reusable appearance fields, even if the input carries unrelated state', () => {
    const document = stored();
    expect(Object.keys(document).sort()).toEqual(['appearance', 'colors', 'format', 'material', 'opacity', 'theme', 'version']);
    expect(document.format).toBe('iboview-appearance-config');
    expect(document.version).toBe(1);
    for (const key of ['isovalue', 'surface', 'spinning', 'orbitalGradient', 'camera', 'scene', 'volume', 'orbital']) {
      expect(document).not.toHaveProperty(key);
      expect(document.appearance).not.toHaveProperty(key);
    }
  });

  it('applies colors to another project while keeping its isovalue, surface and spinning state', () => {
    const config = parseAppearanceConfig(serializeAppearanceConfig(snapshot));
    const destination: DisplaySettings = { ...settings, isovalue: 0.098, surface: true, spinning: false,
      atomPalette: 'vivid', elementColors: { O: '#ff1234' }, positiveColor: '#000000', negativeColor: '#ffffff' };
    const savedConfig = structuredClone(config);
    const savedDestination = structuredClone(destination);
    const result = applyAppearanceConfig(destination, config);
    expect(result).toEqual({ ...settings, isovalue: 0.098, surface: true, spinning: false });
    expect(config).toEqual(savedConfig);
    expect(destination).toEqual(savedDestination);
    result.elementColors.Re = '#ffffff';
    expect(config.appearance.elementColors.Re).toBe('#654321');
    expect(destination.elementColors).toEqual({ O: '#ff1234' });
  });

  it('clears the destination gradient when applying a two-color config', () => {
    const config = parseAppearanceConfig(serializeAppearanceConfig({ ...snapshot, colors: { ...colors, palette: 'custom' } }));
    expect(settings.orbitalGradient).toBeDefined();
    expect(applyAppearanceConfig(settings, config)).not.toHaveProperty('orbitalGradient');
    expect(settings.orbitalGradient).toBeDefined();
  });

  it('accepts a BOM and normalizes a narrow palette range with the shared color rules', () => {
    const document = stored();
    document.colors.vmin = 0.99;
    document.colors.vmax = 1;
    expect(parseAppearanceConfig(`\uFEFF${JSON.stringify(document)}`).colors).toMatchObject({ vmin: 0.98, vmax: 1 });
  });

  it.each(['appearance', 'colors', 'opacity', 'material', 'theme'])('rejects missing required %s instead of applying defaults', field => {
    const document = stored();
    delete document[field];
    expect(() => parseAppearanceConfig(JSON.stringify(document))).toThrow(/Config/);
  });

  it.each([
    ['project file', (document: any) => { document.format = 'iboview-project'; }, /not an IboView appearance/],
    ['newer version', (document: any) => { document.version = 2; }, /Unsupported.*version/],
    ['missing version', (document: any) => { delete document.version; }, /Unsupported.*version/],
    ['empty appearance', (document: any) => { document.appearance = {}; }, /representation/],
    ['empty colors', (document: any) => { document.colors = {}; }, /orbital palette/],
    ['invalid representation', (document: any) => { document.appearance.style = 'cartoon'; }, /representation/],
    ['invalid scale', (document: any) => { document.appearance.atomScale = 100; }, /atom scale/],
    ['invalid boolean', (document: any) => { document.appearance.hydrogens = 'true'; }, /boolean/],
    ['invalid atom color', (document: any) => { document.appearance.atomColor = 'red'; }, /hexadecimal/],
    ['invalid element color', (document: any) => { document.appearance.elementColors.Re = 'red'; }, /hexadecimal/],
    ['invalid element key', (document: any) => { document.appearance.elementColors.constructor = '#123456'; }, /symbol/],
    ['invalid palette', (document: any) => { document.colors.palette = 'unknown'; }, /orbital palette/],
    ['invalid reversal', (document: any) => { document.colors.reversed = 1; }, /boolean/],
    ['invalid phase color', (document: any) => { document.colors.positiveColor = '#fff'; }, /hexadecimal/],
    ['invalid range', (document: any) => { document.colors.vmin = 0.9; document.colors.vmax = 0.1; }, /minimum.*maximum/],
    ['invalid strength', (document: any) => { document.colors.gradientStrength = 3; }, /gradient strength/],
    ['invalid opacity', (document: any) => { document.opacity = 2; }, /opacity/],
    ['invalid material', (document: any) => { document.material = 'matte'; }, /material/],
    ['invalid theme', (document: any) => { document.theme = 'system'; }, /theme/],
  ])('rejects %s before applying any changes', (_label, change, error) => {
    const document = stored();
    change(document);
    expect(() => parseAppearanceConfig(JSON.stringify(document))).toThrow(error);
  });

  it('rejects malformed JSON and nonfinite values on both load and save', () => {
    expect(() => parseAppearanceConfig('{broken')).toThrow(/valid JSON/);
    expect(() => parseAppearanceConfig(serializeAppearanceConfig(snapshot).replace('"opacity": 0.76', '"opacity": 1e999'))).toThrow(/opacity.*finite/);
    expect(() => serializeAppearanceConfig({ ...snapshot, settings: { ...settings, atomScale: NaN } })).toThrow(/atom scale.*finite/);
  });

  it('checks the byte limit before parsing, including multibyte contents', () => {
    expect(MAX_CONFIG_BYTES).toBe(64 * 1024);
    expect(() => parseAppearanceConfig(' '.repeat(MAX_CONFIG_BYTES + 1))).toThrow(/64 KB/);
    expect(() => parseAppearanceConfig('分'.repeat(MAX_CONFIG_BYTES / 2))).toThrow(/64 KB/);
  });

  it.each([
    ['benzene.xyz', 'benzene.iboview-config.json'], ['My view.iboview.json', 'My view.iboview-config.json'],
    ['Colors.iboview-config.json', 'Colors.iboview-config.json'], [' . ', 'IboView appearance.iboview-config.json'],
    ['a/b:c?d', 'a-b-c-d.iboview-config.json'], ['分子颜色', '分子颜色.iboview-config.json'],
  ])('uses a portable config filename for %s', (name, expected) => {
    expect(CONFIG_EXTENSION).toBe('.iboview-config.json');
    expect(configFileName(name)).toBe(expected);
  });
});

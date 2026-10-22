import { describe, expect, it } from 'vitest';
import { sampleColormap } from '../src/lib/palettes/athena-colormaps';
import {
  DEFAULT_ORBITAL_COLORS, hasContinuousRange, orbitalPaletteOptions,
  orbitalPhaseColors, type OrbitalColors,
} from '../src/lib/orbital-colors';

describe('orbital phase palette mapping', () => {
  it.each([
    ['classic', false, '#16736b', '#c37b38'],
    ['classic', true, '#c37b38', '#16736b'],
    ['colorblind', false, '#0072b2', '#e69f00'],
    ['colorblind', true, '#e69f00', '#0072b2'],
  ] as const)('shows the rendered phase pair for %s with reverse=%s', (palette, reversed, positiveColor, negativeColor) => {
    const settings: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette, reversed, vmin: 0.2, vmax: 0.8 };
    expect(orbitalPhaseColors(settings)).toEqual({ positiveColor, negativeColor });
    const preview = orbitalPaletteOptions(settings).find(option => option.value === palette)!.background;
    expect(preview.match(/#[\da-f]{6}/g)).toEqual([positiveColor, positiveColor, negativeColor, negativeColor]);
    expect(hasContinuousRange(palette)).toBe(false);
  });

  it.each([
    [false, 0, 1, '#3b4cc0', '#b40426'],
    [true, 0, 1, '#b40426', '#3b4cc0'],
    [false, 0.125, 0.625, '#6282ea', '#f5c4ac'],
    [true, 0.125, 0.625, '#dd5f4b', '#b9d0f9'],
  ] as const)('samples the visible coolwarm bounds with reverse=%s and range %s–%s', (reversed, vmin, vmax, positiveColor, negativeColor) => {
    const colors = orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'coolwarm', reversed, vmin, vmax });
    expect(colors).toMatchObject({ positiveColor, negativeColor });
    expect(colors.orbitalGradient?.positive[0]).toBe(positiveColor);
    expect(colors.orbitalGradient?.negative[0]).toBe(negativeColor);
    expect(colors.orbitalGradient?.positive.at(-1)).not.toBe(positiveColor);
    expect(colors.orbitalGradient?.negative.at(-1)).not.toBe(negativeColor);
  });

  it('reverses both base colors and neighboring tail ramps together', () => {
    const settings: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette: 'viridis', vmin: 0.2, vmax: 0.8 };
    const normal = orbitalPhaseColors(settings);
    const reversed = orbitalPhaseColors({ ...settings, reversed: true });
    expect(reversed.positiveColor).toBe(normal.negativeColor);
    expect(reversed.orbitalGradient?.positive).toEqual(normal.orbitalGradient?.negative);
    expect(reversed.orbitalGradient?.negative).toEqual(normal.orbitalGradient?.positive);
  });

  it('keeps the neighboring tint subtle and inside even a narrow selected range', () => {
    const wide = orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' });
    expect(wide.orbitalGradient?.positive.at(-1)).toBe(sampleColormap('plasma', 0.08));
    expect(wide.orbitalGradient?.negative.at(-1)).toBe(sampleColormap('plasma', 0.92));
    const narrow = orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', vmin: 0.4, vmax: 0.44 });
    expect(narrow.orbitalGradient?.positive.at(-1)).toBe(sampleColormap('plasma', 0.41));
    expect(narrow.orbitalGradient?.negative.at(-1)).toBe(sampleColormap('plasma', 0.43));
  });

  it('defaults to the outer 20% and changes extent independently of cmap colors', () => {
    const settings: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' };
    const defaults = orbitalPhaseColors(settings);
    const wider = orbitalPhaseColors({ ...settings, gradientExtent: 0.7 });
    expect(defaults.orbitalGradient?.extent).toBe(0.2);
    expect(wider.orbitalGradient?.extent).toBe(0.7);
    expect(wider.orbitalGradient?.positive).toEqual(defaults.orbitalGradient?.positive);
    expect(wider.orbitalGradient?.negative).toEqual(defaults.orbitalGradient?.negative);
  });

  it('turns the tint off at zero strength without changing the phase colors', () => {
    const colors = orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', gradientStrength: 0 });
    expect(new Set(colors.orbitalGradient?.positive)).toEqual(new Set([colors.positiveColor]));
    expect(new Set(colors.orbitalGradient?.negative)).toEqual(new Set([colors.negativeColor]));
  });

  it('increases tint at 200% without crossing phase ramps or the selected cmap bounds', () => {
    const settings: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', gradientStrength: 2 };
    const strong = orbitalPhaseColors(settings);
    expect(strong.orbitalGradient?.positive.at(-1)).toBe(sampleColormap('plasma', 0.16));
    expect(strong.orbitalGradient?.negative.at(-1)).toBe(sampleColormap('plasma', 0.84));
    const narrow = orbitalPhaseColors({ ...settings, vmin: 0.4, vmax: 0.44 });
    expect(narrow.orbitalGradient?.positive.at(-1)).toBe(sampleColormap('plasma', 0.42));
    expect(narrow.orbitalGradient?.negative.at(-1)).toBe(sampleColormap('plasma', 0.42));
  });

  it.each([
    [-1, -1, 0, 0], [2, 3, 1, 2], [NaN, NaN, 0.2, 1],
  ])('normalizes extent %s and strength %s', (gradientExtent, gradientStrength, extent, strength) => {
    const colors = orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'plasma', gradientExtent, gradientStrength });
    expect(colors.orbitalGradient?.extent).toBe(extent);
    expect(colors.orbitalGradient?.positive.at(-1)).toBe(sampleColormap('plasma', 0.08 * strength));
  });

  it('keeps explicit custom phases independent of range and reversal', () => {
    const settings: OrbitalColors = { ...DEFAULT_ORBITAL_COLORS, palette: 'custom',
      reversed: true, vmin: 0.2, vmax: 0.8, positiveColor: '#123456', negativeColor: '#abcdef' };
    expect(orbitalPhaseColors(settings)).toEqual({ positiveColor: '#123456', negativeColor: '#abcdef' });
    const custom = orbitalPaletteOptions(settings)[0];
    expect(custom.value).toBe('custom');
    expect(custom.background.match(/#[\da-f]{6}/g)).toEqual(['#123456', '#123456', '#abcdef', '#abcdef']);
    expect(hasContinuousRange('custom')).toBe(false);
  });

  it('retains all 13 Dr.XAS palettes alongside the native pair', () => {
    const options = orbitalPaletteOptions(DEFAULT_ORBITAL_COLORS);
    const continuous = ['magma', 'viridis', 'plasma', 'inferno', 'cividis', 'coolwarm',
      'ylgnbu', 'turbo', 'hot', 'greys', 'rainbow'];
    expect(options.map(option => option.value)).toEqual(['iboview', 'classic', 'colorblind', ...continuous]);
    expect(options.filter(option => hasContinuousRange(option.value)).map(option => option.value)).toEqual(continuous);
    expect(options.filter(option => option.group === 'Two-color').map(option => option.value)).toEqual(['iboview', 'classic', 'colorblind']);
    expect(options.filter(option => option.group === 'Gradient').map(option => option.value)).toEqual(continuous);
    for (const option of options) {
      expect(!!orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: option.value }).orbitalGradient).toBe(option.group === 'Gradient');
    }
    expect(new Set(options.map(option => option.value)).size).toBe(14);
  });
});

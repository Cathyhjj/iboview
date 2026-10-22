import { describe, expect, it } from 'vitest';
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
    expect(orbitalPhaseColors({ ...DEFAULT_ORBITAL_COLORS, palette: 'coolwarm', reversed, vmin, vmax }))
      .toEqual({ positiveColor, negativeColor });
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
    expect(new Set(options.map(option => option.value)).size).toBe(14);
  });
});

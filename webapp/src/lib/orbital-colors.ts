import { colorscaleGradient, isAthenaColormap, sampleColormap } from './palettes/athena-colormaps';
import { normalizePlotColorRange, plotPaletteOptions, spectrumColors, type PlotPalette } from './palettes/athena-plot-colors';
import type { DisplaySettings } from '../types';

export type OrbitalPalette = 'iboview' | PlotPalette | 'custom';
export interface OrbitalColors {
  palette: OrbitalPalette;
  reversed: boolean;
  vmin: number;
  vmax: number;
  positiveColor: string;
  negativeColor: string;
  gradientExtent: number;
  gradientStrength: number;
}

export const DEFAULT_ORBITAL_COLORS: OrbitalColors = {
  palette: 'iboview', reversed: false, vmin: 0, vmax: 1,
  positiveColor: '#6353e6', negativeColor: '#24c8c4',
  gradientExtent: 0.2, gradientStrength: 1,
};

export function orbitalPhaseColors(settings: OrbitalColors): Pick<DisplaySettings, 'positiveColor' | 'negativeColor' | 'orbitalGradient'> {
  if (settings.palette === 'custom') return { positiveColor: settings.positiveColor, negativeColor: settings.negativeColor };
  if (isAthenaColormap(settings.palette)) {
    const palette = settings.palette;
    const { vmin, vmax } = normalizePlotColorRange(settings);
    const strength = Number.isFinite(settings.gradientStrength) ? Math.max(0, Math.min(2, settings.gradientStrength)) : 1;
    const extent = Number.isFinite(settings.gradientExtent) ? Math.max(0, Math.min(1, settings.gradientExtent)) : 0.2;
    const offset = Math.min(0.08, (vmax - vmin) * 0.25) * strength;
    const sample = (position: number) => sampleColormap(palette, settings.reversed ? 1 - position : position);
    const positive = Array.from({ length: 17 }, (_, i) => sample(vmin + offset * i / 16));
    const negative = Array.from({ length: 17 }, (_, i) => sample(vmax - offset * i / 16));
    return { positiveColor: positive[0], negativeColor: negative[0], orbitalGradient: { positive, negative, extent } };
  }
  const colors = settings.palette === 'iboview'
    ? settings.reversed ? [DEFAULT_ORBITAL_COLORS.negativeColor, DEFAULT_ORBITAL_COLORS.positiveColor]
      : [DEFAULT_ORBITAL_COLORS.positiveColor, DEFAULT_ORBITAL_COLORS.negativeColor]
    : spectrumColors(2, { ...settings, palette: settings.palette });
  return { positiveColor: colors[0], negativeColor: colors[1] };
}

const pairGradient = (first: string, last: string) => colorscaleGradient([[0, first], [0.5, first], [0.5, last], [1, last]]);

export function orbitalPaletteOptions(settings: OrbitalColors): { value: OrbitalPalette; label: string; background: string; group: string }[] {
  const native = orbitalPhaseColors({ ...settings, palette: 'iboview' });
  const options: { value: OrbitalPalette; label: string; background: string; group: string }[] = [
    { value: 'iboview', label: 'IboView · purple–teal', group: 'Two-color', background: pairGradient(native.positiveColor, native.negativeColor) },
    ...plotPaletteOptions(settings.reversed).map(option => {
      if (option.value !== 'classic' && option.value !== 'colorblind') return { ...option, group: 'Gradient' };
      const phases = orbitalPhaseColors({ ...settings, palette: option.value });
      return { ...option, group: 'Two-color', background: pairGradient(phases.positiveColor, phases.negativeColor) };
    }),
  ];
  if (settings.palette === 'custom') options.unshift({ value: 'custom', label: 'Custom phase colors',
    group: 'Two-color', background: pairGradient(settings.positiveColor, settings.negativeColor) });
  return options;
}

export const hasContinuousRange = (palette: OrbitalPalette) => isAthenaColormap(palette);

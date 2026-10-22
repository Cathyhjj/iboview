import { colorscaleGradient, isAthenaColormap } from './palettes/athena-colormaps';
import { plotPaletteOptions, spectrumColors, type PlotPalette } from './palettes/athena-plot-colors';

export type OrbitalPalette = 'iboview' | PlotPalette | 'custom';
export interface OrbitalColors {
  palette: OrbitalPalette;
  reversed: boolean;
  vmin: number;
  vmax: number;
  positiveColor: string;
  negativeColor: string;
}

export const DEFAULT_ORBITAL_COLORS: OrbitalColors = {
  palette: 'iboview', reversed: false, vmin: 0, vmax: 1,
  positiveColor: '#6353e6', negativeColor: '#24c8c4',
};

export function orbitalPhaseColors(settings: OrbitalColors): { positiveColor: string; negativeColor: string } {
  if (settings.palette === 'custom') return { positiveColor: settings.positiveColor, negativeColor: settings.negativeColor };
  const colors = settings.palette === 'iboview'
    ? settings.reversed ? [DEFAULT_ORBITAL_COLORS.negativeColor, DEFAULT_ORBITAL_COLORS.positiveColor]
      : [DEFAULT_ORBITAL_COLORS.positiveColor, DEFAULT_ORBITAL_COLORS.negativeColor]
    : spectrumColors(2, { ...settings, palette: settings.palette });
  return { positiveColor: colors[0], negativeColor: colors[1] };
}

const pairGradient = (first: string, last: string) => colorscaleGradient([[0, first], [0.5, first], [0.5, last], [1, last]]);

export function orbitalPaletteOptions(settings: OrbitalColors): { value: OrbitalPalette; label: string; background: string }[] {
  const native = orbitalPhaseColors({ ...settings, palette: 'iboview' });
  const options: { value: OrbitalPalette; label: string; background: string }[] = [
    { value: 'iboview', label: 'IboView · purple–teal', background: pairGradient(native.positiveColor, native.negativeColor) },
    ...plotPaletteOptions(settings.reversed).map(option => {
      if (option.value !== 'classic' && option.value !== 'colorblind') return option;
      const phases = orbitalPhaseColors({ ...settings, palette: option.value });
      return { ...option, background: pairGradient(phases.positiveColor, phases.negativeColor) };
    }),
  ];
  if (settings.palette === 'custom') options.unshift({ value: 'custom', label: 'Custom phase colors',
    background: pairGradient(settings.positiveColor, settings.negativeColor) });
  return options;
}

export const hasContinuousRange = (palette: OrbitalPalette) => isAthenaColormap(palette);

import { DEFAULT_ORBITAL_COLORS, type OrbitalColors } from './orbital-colors';
import { isPlotPalette, normalizePlotColorRange } from './palettes/athena-plot-colors';

export const ORBITAL_COLORS_STORAGE_KEY = 'iboview-orbital-colors-v1';

const finite = (value: unknown, fallback: number, max = 1): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
const hexColor = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;

export function loadOrbitalColors(storage?: Pick<Storage, 'getItem'>): OrbitalColors {
  const defaults = { ...DEFAULT_ORBITAL_COLORS };
  try {
    const raw = (storage ?? window.localStorage).getItem(ORBITAL_COLORS_STORAGE_KEY);
    if (!raw) return defaults;
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;
    const value = stored as Record<string, unknown>;
    return {
      palette: value.palette === 'iboview' || value.palette === 'custom' || isPlotPalette(value.palette)
        ? value.palette : defaults.palette,
      reversed: typeof value.reversed === 'boolean' ? value.reversed : defaults.reversed,
      ...normalizePlotColorRange({ vmin: finite(value.vmin, defaults.vmin), vmax: finite(value.vmax, defaults.vmax) }),
      positiveColor: hexColor(value.positiveColor, defaults.positiveColor),
      negativeColor: hexColor(value.negativeColor, defaults.negativeColor),
      gradientExtent: finite(value.gradientExtent, defaults.gradientExtent),
      gradientStrength: finite(value.gradientStrength, defaults.gradientStrength, 2),
    };
  } catch {
    return defaults;
  }
}

export function saveOrbitalColors(colors: OrbitalColors, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(ORBITAL_COLORS_STORAGE_KEY, JSON.stringify(colors));
  } catch { /* Keep controls usable when browser storage is unavailable. */ }
}

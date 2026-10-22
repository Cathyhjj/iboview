import type { DisplaySettings } from '../types';

export type DisplayPreferences = Pick<DisplaySettings, 'opacity' | 'material'>;
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = { opacity: 0.55, material: 'extra' };
export const DISPLAY_PREFERENCES_STORAGE_KEY = 'iboview-display-preferences-v1';

export function loadDisplayPreferences(storage?: Pick<Storage, 'getItem'>): DisplayPreferences {
  const defaults = { ...DEFAULT_DISPLAY_PREFERENCES };
  try {
    const raw = (storage ?? window.localStorage).getItem(DISPLAY_PREFERENCES_STORAGE_KEY);
    if (!raw) return defaults;
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;
    const value = stored as Record<string, unknown>;
    return {
      opacity: typeof value.opacity === 'number' && Number.isFinite(value.opacity)
        ? Math.max(0.2, Math.min(1, value.opacity)) : defaults.opacity,
      material: value.material === 'shiny' || value.material === 'soft' || value.material === 'extra'
        ? value.material : defaults.material,
    };
  } catch {
    return defaults;
  }
}

export function saveDisplayPreferences({ opacity, material }: DisplayPreferences, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(DISPLAY_PREFERENCES_STORAGE_KEY, JSON.stringify({ opacity, material }));
  } catch { /* Keep controls usable when browser storage is unavailable. */ }
}

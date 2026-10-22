import type { DisplaySettings } from '../types';
import { DEFAULT_DISPLAY_PREFERENCES } from './display-preferences';
import { normalizeMoleculeAppearance, type MoleculeAppearance } from './molecule-appearance';
import { loadOrbitalColors } from './orbital-color-storage';
import { orbitalPhaseColors, type OrbitalColors } from './orbital-colors';

export interface MoleculeViewPreferences {
  appearance: MoleculeAppearance;
  colors: OrbitalColors;
  opacity: number;
  material: DisplaySettings['material'];
}

export const MOLECULE_VIEW_PREFERENCES_STORAGE_KEY = 'iboview-molecule-view-preferences-v1';
const MAX_SAVED_PREFERENCES = 128;
interface SavedPreferences { key: string; preferences: MoleculeViewPreferences }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isGeometryKey = (key: unknown): key is string => typeof key === 'string' && /^geometry-[0-9a-f]{16}$/.test(key);

function normalizePreferences(appearance: unknown, colors: unknown, opacity: unknown, material: unknown): MoleculeViewPreferences {
  return {
    appearance: normalizeMoleculeAppearance(appearance),
    colors: loadOrbitalColors({ getItem: () => JSON.stringify(colors) }),
    opacity: typeof opacity === 'number' && Number.isFinite(opacity)
      ? Math.max(0, Math.min(1, opacity)) : DEFAULT_DISPLAY_PREFERENCES.opacity,
    material: material === 'shiny' || material === 'soft' || material === 'extra'
      ? material : DEFAULT_DISPLAY_PREFERENCES.material,
  };
}

export function moleculeViewPreferences(settings: DisplaySettings, colors: OrbitalColors): MoleculeViewPreferences {
  return normalizePreferences(settings, colors, settings.opacity, settings.material);
}

function storedPreferences(value: unknown): MoleculeViewPreferences | undefined {
  if (!isRecord(value) || !isRecord(value.appearance) || !isRecord(value.colors)
    || !Object.hasOwn(value, 'opacity') || !Object.hasOwn(value, 'material')) return undefined;
  return normalizePreferences(value.appearance, value.colors, value.opacity, value.material);
}

function readPreferences(raw: string | null): SavedPreferences[] {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!Array.isArray(value)) return [];
    const preferences = new Map<string, MoleculeViewPreferences>();
    for (const item of value) {
      const normalized = storedPreferences(item?.preferences);
      if (!isGeometryKey(item?.key) || !normalized) continue;
      preferences.delete(item.key);
      preferences.set(item.key, normalized);
    }
    return [...preferences].slice(-MAX_SAVED_PREFERENCES).map(([key, preferences]) => ({ key, preferences }));
  } catch { return []; }
}

export function loadMoleculeViewPreferences(key: string, storage?: Pick<Storage, 'getItem'>): MoleculeViewPreferences | undefined {
  if (!isGeometryKey(key)) return undefined;
  try {
    return readPreferences((storage ?? window.localStorage).getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY))
      .find(item => item.key === key)?.preferences;
  } catch { return undefined; }
}

export function saveMoleculeViewPreferences(
  key: string, value: MoleculeViewPreferences, storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const preferences = storedPreferences(value);
  if (!isGeometryKey(key) || !preferences) return;
  try {
    const target = storage ?? window.localStorage;
    const entries = readPreferences(target.getItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY)).filter(item => item.key !== key);
    entries.push({ key, preferences });
    target.setItem(MOLECULE_VIEW_PREFERENCES_STORAGE_KEY, JSON.stringify(entries.slice(-MAX_SAVED_PREFERENCES)));
  } catch { /* Appearance controls remain usable when browser storage is unavailable. */ }
}

export function applyMoleculeViewPreferences(settings: DisplaySettings, preferences: MoleculeViewPreferences): DisplaySettings {
  const normalized = normalizePreferences(preferences.appearance, preferences.colors, preferences.opacity, preferences.material);
  const phases = orbitalPhaseColors(normalized.colors);
  const result = { ...settings, ...normalized.appearance, opacity: normalized.opacity, material: normalized.material, ...phases };
  if (!phases.orbitalGradient) delete result.orbitalGradient;
  return result;
}

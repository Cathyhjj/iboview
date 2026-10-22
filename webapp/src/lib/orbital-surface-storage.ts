import type { DisplaySettings } from '../types';

export type OrbitalSurfacePreferences = Pick<DisplaySettings, 'isovalue' | 'surface'>;
export const ORBITAL_SURFACES_STORAGE_KEY = 'iboview-orbital-surfaces-v1';
const MAX_SAVED_SURFACES = 32;
interface SavedSurface { key: string; preferences: OrbitalSurfacePreferences }

const isGeometryKey = (key: unknown): key is string => typeof key === 'string' && /^geometry-[0-9a-f]{16}$/.test(key);

function normalizePreferences(value: unknown): OrbitalSurfacePreferences | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  return typeof input.isovalue === 'number' && Number.isFinite(input.isovalue) && input.isovalue > 0
    && typeof input.surface === 'boolean' ? { isovalue: input.isovalue, surface: input.surface } : undefined;
}

function readSurfaces(raw: string | null): SavedSurface[] {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!Array.isArray(value)) return [];
    const surfaces = new Map<string, OrbitalSurfacePreferences>();
    for (const item of value) {
      const preferences = normalizePreferences(item?.preferences);
      if (!isGeometryKey(item?.key) || !preferences) continue;
      surfaces.delete(item.key);
      surfaces.set(item.key, preferences);
    }
    return [...surfaces].slice(-MAX_SAVED_SURFACES).map(([key, preferences]) => ({ key, preferences }));
  } catch { return []; }
}

export function loadOrbitalSurfacePreferences(key: string, storage?: Pick<Storage, 'getItem'>): OrbitalSurfacePreferences | undefined {
  if (!isGeometryKey(key)) return undefined;
  try {
    return readSurfaces((storage ?? window.localStorage).getItem(ORBITAL_SURFACES_STORAGE_KEY))
      .find(item => item.key === key)?.preferences;
  } catch { return undefined; }
}

export function saveOrbitalSurfacePreferences(
  key: string, value: OrbitalSurfacePreferences, storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  const preferences = normalizePreferences(value);
  if (!isGeometryKey(key) || !preferences) return;
  try {
    const target = storage ?? window.localStorage;
    const surfaces = readSurfaces(target.getItem(ORBITAL_SURFACES_STORAGE_KEY)).filter(item => item.key !== key);
    surfaces.push({ key, preferences });
    target.setItem(ORBITAL_SURFACES_STORAGE_KEY, JSON.stringify(surfaces.slice(-MAX_SAVED_SURFACES)));
  } catch { /* Surface controls remain usable when browser storage is unavailable. */ }
}

export function restoreOrbitalSurfacePreferences(
  saved: unknown, fallback: OrbitalSurfacePreferences, range: { min: number; max: number },
): OrbitalSurfacePreferences {
  const preferences = normalizePreferences(saved) ?? fallback;
  return { isovalue: Math.max(range.min, Math.min(range.max, preferences.isovalue)), surface: preferences.surface };
}

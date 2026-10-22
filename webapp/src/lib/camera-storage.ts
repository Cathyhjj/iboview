import type { Atom } from './importers';
import { normalizeCameraState, type CameraState } from './camera-state';

export const CAMERA_STORAGE_KEY = 'iboview-camera-views-v1';
const MAX_SAVED_VIEWS = 32;
interface SavedView { key: string; state: CameraState }

/** Geometry, not the file name or selected orbital, identifies a saved view. */
export function cameraKeyForStructure(atoms: readonly Atom[]): string {
  const text = JSON.stringify(atoms.map(({ element, x, y, z }) => [element, x, y, z]));
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index++) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(index))) * 0x100000001b3n);
  }
  return `geometry-${hash.toString(16).padStart(16, '0')}`;
}

function readViews(raw: string | null): SavedView[] {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (!Array.isArray(value)) return [];
    return value.flatMap(item => {
      const state = normalizeCameraState(item?.state);
      return typeof item?.key === 'string' && /^geometry-[0-9a-f]{16}$/.test(item.key) && state
        ? [{ key: item.key, state }] : [];
    }).slice(-MAX_SAVED_VIEWS);
  } catch { return []; }
}

export function loadCameraState(key: string, storage?: Pick<Storage, 'getItem'>): CameraState | undefined {
  try { return readViews((storage ?? window.localStorage).getItem(CAMERA_STORAGE_KEY)).find(item => item.key === key)?.state; }
  catch { return undefined; }
}

export function saveCameraState(key: string, value: CameraState, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  const state = normalizeCameraState(value);
  if (!state || !/^geometry-[0-9a-f]{16}$/.test(key)) return;
  try {
    const target = storage ?? window.localStorage;
    const views = readViews(target.getItem(CAMERA_STORAGE_KEY)).filter(item => item.key !== key);
    views.push({ key, state });
    target.setItem(CAMERA_STORAGE_KEY, JSON.stringify(views.slice(-MAX_SAVED_VIEWS)));
  } catch { /* View controls remain usable when browser storage is unavailable. */ }
}

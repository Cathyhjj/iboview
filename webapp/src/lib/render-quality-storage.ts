import { DEFAULT_RENDER_QUALITY, type RenderQuality } from './render-quality';

export const RENDER_QUALITY_STORAGE_KEY = 'iboview-render-quality-v1';

export function loadRenderQuality(storage?: Pick<Storage, 'getItem'>): RenderQuality {
  try {
    const value = (storage ?? window.localStorage).getItem(RENDER_QUALITY_STORAGE_KEY);
    return value === 'fast' || value === 'balanced' || value === 'smooth' ? value : DEFAULT_RENDER_QUALITY;
  } catch { return DEFAULT_RENDER_QUALITY; }
}

export function saveRenderQuality(value: RenderQuality, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(RENDER_QUALITY_STORAGE_KEY, value);
  } catch { /* Quality controls remain usable when storage is unavailable. */ }
}

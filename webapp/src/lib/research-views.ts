import { normalizeCameraState, type CameraState } from './camera-state';
import type { Atom } from './importers';

export interface NamedView { name: string; camera: CameraState; referenceCenter?: CameraState['center'] }
export function normalizeNamedViews(value: unknown): NamedView[] {
  if (!Array.isArray(value)) return [];
  const result: NamedView[] = [];
  for (const item of value.slice(0,30)) {
    const camera = normalizeCameraState(item?.camera);
    if (camera && typeof item.name === 'string' && item.name.trim()) {
      const name = item.name.trim().slice(0,80);
      const referenceCenter=Array.isArray(item.referenceCenter)&&item.referenceCenter.length===3&&item.referenceCenter.every((n:unknown)=>typeof n==='number'&&Number.isFinite(n)) ? item.referenceCenter as CameraState['center'] : undefined;
      if (!result.some(v => v.name === name)) result.push({ name, camera,...(referenceCenter?{referenceCenter}: {}) });
    }
  }
  return result;
}
export function loadNamedViews(key: string): NamedView[] {
  try { return normalizeNamedViews(JSON.parse(localStorage.getItem(`iboview-views-${key}`) ?? '[]')); } catch { return []; }
}
export function saveNamedViews(key: string, views: NamedView[]): void {
  localStorage.setItem(`iboview-views-${key}`,JSON.stringify(normalizeNamedViews(views)));
}
export function atomCenter(atoms: Atom[]): CameraState['center'] {
  return ['x','y','z'].map(axis => {
    const values = atoms.map(a => a[axis as 'x'|'y'|'z']);
    return (Math.min(...values)+Math.max(...values))/2;
  }) as CameraState['center'];
}
/** Preserve each structure's pivot while sharing world-space scale and orientation. */
type LinkedCameraState = CameraState & { perspectiveDistance?: number };
export function linkedCamera(source: LinkedCameraState, target: LinkedCameraState): LinkedCameraState {
  const fit = Math.max(source.fittedHalfHeight,target.fittedHalfHeight);
  return { ...source, center:[...target.center], fittedHalfHeight:fit,
    halfHeight:Math.max(fit/30,Math.min(fit*20,source.halfHeight)),
    cameraDistance:Math.max(source.cameraDistance,target.cameraDistance),
    perspectiveDistance:Math.max(source.perspectiveDistance ?? source.fittedHalfHeight/Math.tan(Math.PI*17.5/180),
      target.perspectiveDistance ?? target.fittedHalfHeight/Math.tan(Math.PI*17.5/180)) };
}
export function namedCamera(view:NamedView, target:CameraState, center:CameraState['center']):CameraState {
  const reference=view.referenceCenter??center;
  return linkedCamera(view.camera,{...target,center:center.map((n,i)=>n+view.camera.center[i]-reference[i]) as CameraState['center']});
}
export function downloadBlob(blob: Blob, name: string): void {
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url; link.download=name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url),10000);
}
export function safeFilename(value: string): string {
  return value.replace(/[^\p{L}\p{N} ._-]/gu,'-').replace(/^[. ]+|[. ]+$/g,'').slice(0,100) || 'view';
}

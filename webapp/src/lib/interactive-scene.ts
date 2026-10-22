import type { CameraState } from './camera-state';
import type { MeshData } from '../render/geometry';
import type { DisplaySettings } from '../types';

export interface InteractiveView {
  title: string;
  source: string;
  orbital?: string;
  isovalue: number;
  molecule: MeshData;
  orbitalMesh: MeshData;
  camera: CameraState;
  aspect: number;
  theme: 'light' | 'dark';
  settings: Pick<DisplaySettings, 'material' | 'atomMaterial' | 'opacity' | 'spinning'>;
  labels: Array<{ text: string; x: number; y: number; z: number }>;
}
export interface PackedMesh { positions: string; normals: string; colors: string; indices: string }
export interface PackedInteractiveView extends Omit<InteractiveView, 'molecule' | 'orbitalMesh'> {
  version: 1;
  molecule: PackedMesh;
  orbitalMesh: PackedMesh;
}

function encode(values: Float32Array | Uint32Array): string {
  const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new Error('The current geometry contains invalid coordinates or colors.');
    if (values instanceof Uint32Array) view.setUint32(i * 4, values[i], true);
    else view.setFloat32(i * 4, values[i], true);
  }
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(''));
}
function decode(encoded: string, integer: boolean): Float32Array | Uint32Array {
  const raw = atob(encoded);
  if (raw.length % 4) throw new Error('Invalid molecular geometry.');
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0)), view = new DataView(bytes.buffer);
  const values = integer ? new Uint32Array(bytes.length / 4) : new Float32Array(bytes.length / 4);
  for (let i = 0; i < values.length; i++) values[i] = integer ? view.getUint32(i * 4, true) : view.getFloat32(i * 4, true);
  return values;
}
export function packMesh(mesh: MeshData): PackedMesh {
  return { positions: encode(mesh.positions), normals: encode(mesh.normals), colors: encode(mesh.colors), indices: encode(mesh.indices) };
}
export function unpackMesh(mesh: PackedMesh): MeshData {
  return { positions: decode(mesh.positions, false) as Float32Array, normals: decode(mesh.normals, false) as Float32Array,
    colors: decode(mesh.colors, false) as Float32Array, indices: decode(mesh.indices, true) as Uint32Array };
}
export function packInteractiveView(view: InteractiveView): PackedInteractiveView {
  return { ...view, version: 1, molecule: packMesh(view.molecule), orbitalMesh: packMesh(view.orbitalMesh) };
}

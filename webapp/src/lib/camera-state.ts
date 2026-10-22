export interface CameraState {
  rotation: [number, number, number, number];
  center: [number, number, number];
  pan: [number, number];
  halfHeight: number;
  fittedHalfHeight: number;
  cameraDistance: number;
}

export function normalizeCameraState(value: unknown): CameraState | undefined {
  if (!value || typeof value !== 'object') return;
  const state = value as Record<string, unknown>;
  const vector = (value: unknown, length: number): value is number[] => Array.isArray(value)
    && value.length === length && value.every(item => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1e9);
  const positive = (value: unknown): value is number => typeof value === 'number'
    && Number.isFinite(value) && value >= 1e-6 && value <= 1e9;
  if (!vector(state.rotation, 4) || !vector(state.center, 3) || !vector(state.pan, 2)
    || !positive(state.halfHeight) || !positive(state.fittedHalfHeight) || !positive(state.cameraDistance)) return;
  const length = Math.hypot(...state.rotation);
  if (length < 1e-12 || state.halfHeight < state.fittedHalfHeight / 30 - 1e-8
    || state.halfHeight > state.fittedHalfHeight * 20 + 1e-8) return;
  return {
    rotation: state.rotation.map(item => Math.abs(length - 1) < 1e-12 ? item : item / length) as CameraState['rotation'],
    center: [...state.center] as CameraState['center'], pan: [...state.pan] as CameraState['pan'],
    halfHeight: state.halfHeight, fittedHalfHeight: state.fittedHalfHeight, cameraDistance: state.cameraDistance,
  };
}

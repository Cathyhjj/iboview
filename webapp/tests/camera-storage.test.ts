import { describe, expect, it } from 'vitest';
import { normalizeCameraState, type CameraState } from '../src/lib/camera-state';
import { CAMERA_STORAGE_KEY, cameraKeyForStructure, loadCameraState, saveCameraState } from '../src/lib/camera-storage';

const view: CameraState = {
  rotation: [0, 0.6, 0, 0.8], center: [1, 2, 3], pan: [-1.5, 0.25],
  halfHeight: 4, fittedHalfHeight: 7, cameraDistance: 100,
};
const atoms = [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'H', x: 1, y: 0, z: 0 }];
const key = cameraKeyForStructure(atoms);
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('per-molecule camera persistence', () => {
  it('uses the same key for reimported geometry and different keys for changed atoms or coordinates', () => {
    expect(cameraKeyForStructure(JSON.parse(JSON.stringify(atoms)))).toBe(key);
    expect(cameraKeyForStructure(atoms.map(atom => ({ ...atom, x: atom.x + 0.1 })))).not.toBe(key);
    expect(cameraKeyForStructure([{ ...atoms[0], element: 'N' }, atoms[1]])).not.toBe(key);
  });

  it('restores complete, independent views for separate geometries', () => {
    const storage = memoryStorage();
    const second = cameraKeyForStructure([atoms[0]]);
    const other: CameraState = { ...view, pan: [5, -3], halfHeight: 2 };
    saveCameraState(key, view, storage);
    saveCameraState(second, other, storage);
    expect(loadCameraState(key, storage)).toEqual(view);
    expect(loadCameraState(second, storage)).toEqual(other);
    const loaded = loadCameraState(key, storage)!;
    loaded.rotation[0] = 100;
    expect(loadCameraState(key, storage)).toEqual(view);
  });

  it('replaces a saved view, including a reset view, without duplicate records', () => {
    const storage = memoryStorage();
    saveCameraState(key, view, storage);
    const reset: CameraState = { ...view, rotation: [0, 0, 0, 1], pan: [0, 0], halfHeight: view.fittedHalfHeight };
    saveCameraState(key, reset, storage);
    expect(loadCameraState(key, storage)).toEqual(reset);
    expect(JSON.parse(storage.getItem(CAMERA_STORAGE_KEY)!)).toHaveLength(1);
  });

  it('bounds saved history to the 32 most recently changed geometries', () => {
    const storage = memoryStorage();
    for (let i = 0; i < 40; i++) saveCameraState(cameraKeyForStructure([{ ...atoms[0], x: i }]), view, storage);
    expect(JSON.parse(storage.getItem(CAMERA_STORAGE_KEY)!)).toHaveLength(32);
    expect(loadCameraState(cameraKeyForStructure([{ ...atoms[0], x: 0 }]), storage)).toBeUndefined();
    expect(loadCameraState(cameraKeyForStructure([{ ...atoms[0], x: 39 }]), storage)).toEqual(view);
  });

  it.each(['{bad', 'null', '{}', '[null,42,{"key":"wrong"}]'])('ignores damaged saved records: %s', raw => {
    const storage = memoryStorage();
    storage.setItem(CAMERA_STORAGE_KEY, raw);
    expect(loadCameraState(key, storage)).toBeUndefined();
    saveCameraState(key, view, storage);
    expect(loadCameraState(key, storage)).toEqual(view);
  });

  it('tolerates unavailable storage without interrupting camera controls', () => {
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadCameraState(key, blocked)).toBeUndefined();
    expect(() => saveCameraState(key, view, blocked)).not.toThrow();
    expect(loadCameraState(key)).toBeUndefined();
    expect(() => saveCameraState(key, view)).not.toThrow();
  });
});

describe('camera state validation', () => {
  it('normalizes rotation while preserving translation, scale, and native zoom extremes', () => {
    expect(normalizeCameraState({ ...view, rotation: [0, 0, 0, 5] })?.rotation).toEqual([0, 0, 0, 1]);
    for (const factor of [1 / 30, 1, 20]) {
      const state = { ...view, halfHeight: view.fittedHalfHeight * factor };
      expect(normalizeCameraState(state)).toEqual(state);
    }
  });

  it.each([
    { rotation: [0, 0, 0, 0] }, { rotation: [0, 1, 0] }, { center: [NaN, 0, 0] },
    { pan: ['1', 0] }, { halfHeight: 0 }, { fittedHalfHeight: Infinity },
    { cameraDistance: -1 }, { halfHeight: 1000 },
  ])('rejects unusable camera fields %j', patch => {
    expect(normalizeCameraState({ ...view, ...patch })).toBeUndefined();
  });
});

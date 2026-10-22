import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraState } from '../src/lib/camera-state';
import { NativeIboRenderer } from '../src/render/NativeIboRenderer';

function cameraFixture() {
  const renderer = Object.create(NativeIboRenderer.prototype) as NativeIboRenderer;
  const render = vi.fn();
  Object.assign(renderer, {
    canvas: { width: 800, height: 600, clientWidth: 800, clientHeight: 600 },
    quaternion: [0, 0, 0, 1], center: [0, 0, 0], pan: [0, 0],
    halfHeight: 5, fittedHalfHeight: 5, cameraDistance: 60,
    bounds: { min: [-3, -3, -3], max: [3, 3, 3] },
    frame: 0, lastTime: 0, spinning: false, destroyed: false, contextLost: false,
    render,
  });
  return { renderer, render };
}

afterEach(() => vi.unstubAllGlobals());

describe('renderer camera state', () => {
  it('returns independent snapshots and restores the complete projected view without notifying', () => {
    const { renderer, render } = cameraFixture();
    const changed = vi.fn();
    renderer.setCameraChangeListener(changed);
    const input: CameraState = {
      rotation: [0, 0, 1, 0], center: [1, -2, 3], pan: [0.4, -0.7],
      halfHeight: 3, fittedHalfHeight: 7, cameraDistance: 90,
    };
    expect(renderer.restoreCameraState(input)).toBe(true);
    expect(render).toHaveBeenCalledOnce();
    expect(changed).not.toHaveBeenCalled();
    const snapshot = renderer.getCameraState();
    expect(snapshot).toEqual(input);
    expect(snapshot.rotation).not.toBe(input.rotation);
    expect(snapshot.center).not.toBe(input.center);
    expect(snapshot.pan).not.toBe(input.pan);
    const next = cameraFixture().renderer;
    expect(next.restoreCameraState(snapshot)).toBe(true);
    expect(next.project({ x: 2, y: 3, z: -1 })).toEqual(renderer.project({ x: 2, y: 3, z: -1 }));
    input.rotation[0] = 0.5;
    input.center[0] = 20;
    input.pan[0] = 30;
    snapshot.rotation[1] = 0.8;
    snapshot.center[1] = 40;
    snapshot.pan[1] = 50;
    expect(renderer.getCameraState()).toEqual(next.getCameraState());
  });

  it('rejects invalid state atomically without rendering or notifying', () => {
    const { renderer, render } = cameraFixture();
    const changed = vi.fn();
    renderer.setCameraChangeListener(changed);
    const original = renderer.getCameraState();
    for (const state of [null, {}, { ...original, halfHeight: 0 }, { ...original, rotation: [0, 0, 0, 0] }, { ...original, pan: [NaN, 0] }]) {
      expect(renderer.restoreCameraState(state)).toBe(false);
      expect(renderer.getCameraState()).toEqual(original);
    }
    expect(render).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps fitting silent and reports the completed fit-and-orient view', () => {
    const { renderer, render } = cameraFixture();
    const changed = vi.fn(() => renderer.getCameraState());
    renderer.setCameraChangeListener(changed);
    renderer.fit({ min: [-2, -3, -4], max: [8, 5, 2] });
    expect(changed).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    renderer.orient('top');
    expect(changed).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledOnce();
    const state = changed.mock.results[0].value as CameraState;
    expect(state.center).toEqual([3, 1, -1]);
    expect(state.rotation).toEqual([0, 0, 0, 1]);
    expect(state.pan).toEqual([0, 0]);
    expect(state.halfHeight).toBe(state.fittedHalfHeight);
    renderer.orient('side');
    expect(changed).toHaveBeenCalledTimes(2);
    expect(renderer.getCameraState().rotation[0]).toBeCloseTo(Math.SQRT1_2);
  });

  it('reports zoom changes within the saved fit bounds and supports removing the listener', () => {
    const { renderer } = cameraFixture();
    const changed = vi.fn();
    renderer.setCameraChangeListener(changed);
    renderer.zoom(2);
    expect(renderer.getCameraState().halfHeight).toBe(2.5);
    expect(changed).toHaveBeenCalledOnce();
    for (const factor of [0, -1, NaN, Infinity, 1]) renderer.zoom(factor);
    expect(changed).toHaveBeenCalledOnce();
    renderer.zoom(Number.MAX_VALUE);
    expect(renderer.getCameraState().halfHeight).toBe(5 / 30);
    renderer.zoom(Number.MAX_VALUE);
    expect(changed).toHaveBeenCalledTimes(2);
    renderer.zoom(Number.MIN_VALUE);
    expect(renderer.getCameraState().halfHeight).toBe(100);
    expect(changed).toHaveBeenCalledTimes(3);
    renderer.setCameraChangeListener();
    renderer.zoom(2);
    renderer.orient('default');
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it('reports spin rotation frames while leaving initial and pointer-paused frames silent', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    const advance = (time: number) => {
      const [id, callback] = callbacks.entries().next().value!;
      callbacks.delete(id);
      callback(time);
    };
    const { renderer } = cameraFixture();
    const changed = vi.fn();
    renderer.setCameraChangeListener(changed);
    renderer.setSpinning(true);
    advance(100);
    expect(changed).not.toHaveBeenCalled();
    advance(116);
    expect(changed).toHaveBeenCalledOnce();
    const rotating = renderer.getCameraState();
    expect(rotating.rotation[1]).toBeGreaterThan(0);
    expect(Math.hypot(...rotating.rotation)).toBeCloseTo(1);
    Object.assign(renderer, { pointer: { id: 1, x: 10, y: 20, pan: false } });
    advance(132);
    expect(renderer.getCameraState()).toEqual(rotating);
    expect(changed).toHaveBeenCalledOnce();
    Object.assign(renderer, { pointer: undefined });
    advance(148);
    expect(changed).toHaveBeenCalledTimes(2);
    renderer.setSpinning(false);
    expect(callbacks.size).toBe(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeIboRenderer, type PNGExportOptions, type PNGExportScale } from '../src/render/NativeIboRenderer';

interface FixtureOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  textureLimit?: number;
  renderbufferLimit?: number;
  viewportLimit?: [number, number];
}

function exportFixture({ width = 640.25, height = 359.75, pixelRatio = 1.5,
  textureLimit = 16384, renderbufferLimit = 16384, viewportLimit = [16384, 16384] }: FixtureOptions = {}) {
  vi.stubGlobal('window', { devicePixelRatio: pixelRatio });
  const renderer = Object.create(NativeIboRenderer.prototype) as NativeIboRenderer;
  const canvas = { width: 1, height: 1, clientWidth: width, clientHeight: height };
  const buffers = { targets: [] as object[] };
  const gl = {
    MAX_TEXTURE_SIZE: 0x0d33, MAX_RENDERBUFFER_SIZE: 0x84e8, MAX_VIEWPORT_DIMS: 0x0d3a,
    TEXTURE_2D: 0x0de1, FRAMEBUFFER: 0x8d40,
    getParameter(parameter: number) {
      if (parameter === this.MAX_TEXTURE_SIZE) return textureLimit;
      if (parameter === this.MAX_RENDERBUFFER_SIZE) return renderbufferLimit;
      if (parameter === this.MAX_VIEWPORT_DIMS) return new Int32Array(viewportLimit);
      throw new Error(`Unexpected graphics parameter: ${parameter}`);
    },
    isContextLost: () => false,
    bindTexture: vi.fn(), bindFramebuffer: vi.fn(),
  };
  const deleteTargets = vi.fn(() => {
    buffers.targets = [];
    Object.assign(renderer, { targets: buffers.targets });
  });
  const makeTarget = vi.fn(() => {
    const target = {};
    buffers.targets.push(target);
    return target;
  });
  // Replace GPU drawing while retaining the real export sizing and restoration path.
  const render = vi.fn((options: PNGExportOptions = {}) => renderer.resize(options.scale));
  Object.assign(renderer, {
    canvas, gl, targets: buffers.targets, deleteTargets, makeTarget, render,
    quaternion: [0, 0, 0, 1], center: [1, -2, 3], pan: [0.4, -0.7],
    halfHeight: 5, fittedHalfHeight: 7, cameraDistance: 60,
    destroyed: false, contextLost: false,
  });
  renderer.resize();
  deleteTargets.mockClear();
  makeTarget.mockClear();
  return { renderer, canvas, buffers, deleteTargets, makeTarget, render };
}

function outputFixture(drawImage = vi.fn()) {
  const output = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })) };
  vi.stubGlobal('document', { createElement: vi.fn(() => output) });
  return output;
}

afterEach(() => vi.unstubAllGlobals());

describe('PNG export resolution', () => {
  it.each([
    [1, 800, 600],
    [2, 1600, 1200],
    [3, 1600, 1200],
  ])('keeps the normal backing resolution at device pixel ratio %s', (pixelRatio, width, height) => {
    const { canvas } = exportFixture({ width: 800, height: 600, pixelRatio });
    expect([canvas.width, canvas.height]).toEqual([width, height]);
  });

  it.each<PNGExportScale>([1, 2, 4])('multiplies rounded base dimensions exactly by %s without changing the camera framing', scale => {
    const { renderer, canvas } = exportFixture();
    const camera = renderer.getCameraState();
    const projected = renderer.project({ x: 2, y: 3, z: -1 });
    expect([canvas.width, canvas.height]).toEqual([960, 540]);
    renderer.resize(scale);
    expect([canvas.width, canvas.height]).toEqual([960 * scale, 540 * scale]);
    expect(renderer.project({ x: 2, y: 3, z: -1 })).toEqual(projected);
    expect(renderer.getCameraState()).toEqual(camera);
  });

  it.each<[string, FixtureOptions]>([
    ['texture dimensions', { textureLimit: 2048 }],
    ['renderbuffer dimensions', { renderbufferLimit: 2048 }],
    ['viewport dimensions', { viewportLimit: [4096, 1024] }],
    ['total pixel allocation', { width: 1400, height: 900, pixelRatio: 2 }],
  ])('rejects exports exceeding %s before replacing the current canvas or buffers', (_limit, options) => {
    const { renderer, canvas, buffers, deleteTargets, makeTarget } = exportFixture(options);
    const dimensions = [canvas.width, canvas.height];
    const targets = buffers.targets;
    const camera = renderer.getCameraState();
    expect(() => renderer.resize(4)).toThrow(/lower resolution/i);
    expect([canvas.width, canvas.height]).toEqual(dimensions);
    expect(buffers.targets).toBe(targets);
    expect(deleteTargets).not.toHaveBeenCalled();
    expect(makeTarget).not.toHaveBeenCalled();
    expect(renderer.getCameraState()).toEqual(camera);
  });

  it.each<[PNGExportScale, boolean]>([[2, false], [4, false], [2, true], [4, true]])(
    'copies the %s× export with transparency %s before restoring the normal viewer', (scale, transparentBackground) => {
      const { renderer, canvas, render } = exportFixture();
      const camera = renderer.getCameraState();
      const copiedDimensions: number[][] = [];
      const drawImage = vi.fn(() => copiedDimensions.push([canvas.width, canvas.height]));
      const output = outputFixture(drawImage);
      expect(renderer.exportCanvas({ scale, transparentBackground })).toBe(output);
      expect([output.width, output.height]).toEqual([960 * scale, 540 * scale]);
      expect(copiedDimensions).toEqual([[960 * scale, 540 * scale]]);
      expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0);
      expect([canvas.width, canvas.height]).toEqual([960, 540]);
      expect(renderer.getCameraState()).toEqual(camera);
      expect(render).toHaveBeenLastCalledWith();
    },
  );

  it('restores viewer dimensions and camera when copying the enlarged image fails', () => {
    const { renderer, canvas } = exportFixture();
    const camera = renderer.getCameraState();
    outputFixture(vi.fn(() => { throw new Error('Image copy failed'); }));
    expect(() => renderer.exportCanvas({ scale: 4, transparentBackground: true })).toThrow('Image copy failed');
    expect([canvas.width, canvas.height]).toEqual([960, 540]);
    expect(renderer.getCameraState()).toEqual(camera);
  });
});

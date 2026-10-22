import { afterEach, describe, expect, it, vi } from 'vitest';
import { alphaBounds, cropTransparentCanvas } from '../src/lib/png-crop';

function imageFixture(width: number, height: number, pixels: [number, number, number][] = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y, alpha] of pixels) {
    data.set([x + 10, y + 20, 50, alpha], (y * width + x) * 4);
  }
  return { data, width, height };
}

function canvasFixture(image: ReturnType<typeof imageFixture>) {
  const canvas = {
    width: image.width,
    height: image.height,
    getContext: () => ({ getImageData: () => image }),
  } as unknown as HTMLCanvasElement;
  let croppedPixels = new Uint8ClampedArray();
  const cropped = {
    width: 0,
    height: 0,
    getContext: () => ({
      putImageData(source: ImageData, dx: number, dy: number,
        dirtyX: number, dirtyY: number, dirtyWidth: number, dirtyHeight: number) {
        croppedPixels = new Uint8ClampedArray(cropped.width * cropped.height * 4);
        for (let y = dirtyY; y < dirtyY + dirtyHeight; y++) {
          for (let x = dirtyX; x < dirtyX + dirtyWidth; x++) {
            const src = (y * source.width + x) * 4;
            const dest = ((y + dy) * cropped.width + x + dx) * 4;
            croppedPixels.set(source.data.subarray(src, src + 4), dest);
          }
        }
      },
    }),
  } as unknown as HTMLCanvasElement;
  vi.stubGlobal('document', { createElement: () => cropped });
  return { canvas, cropped, pixels: () => croppedPixels };
}

afterEach(() => vi.unstubAllGlobals());

describe('PNG alpha bounds', () => {
  it('finds no content in a fully transparent image, including invisible RGB values', () => {
    expect(alphaBounds(imageFixture(4, 3, [[1, 2, 0]]))).toBeNull();
  });

  it('keeps the complete dimensions of an opaque image', () => {
    const image = imageFixture(3, 2);
    image.data.fill(255);
    expect(alphaBounds(image)).toEqual({ x: 0, y: 0, width: 3, height: 2 });
  });

  it.each([[0, 0], [4, 0], [0, 3], [4, 3]])('keeps a single content pixel at edge (%s, %s)', (x, y) => {
    expect(alphaBounds(imageFixture(5, 4, [[x, y, 255]])))
      .toEqual({ x, y, width: 1, height: 1 });
  });

  it('retains even the faintest antialiased pixels around translucent content', () => {
    expect(alphaBounds(imageFixture(7, 6, [[2, 1, 1], [3, 2, 100], [4, 4, 1]])))
      .toEqual({ x: 2, y: 1, width: 3, height: 4 });
  });

  it('includes separated content and labels with transparent holes between them', () => {
    expect(alphaBounds(imageFixture(12, 10, [[2, 3, 255], [4, 6, 120], [9, 1, 180]])))
      .toEqual({ x: 2, y: 1, width: 8, height: 6 });
  });

  it('removes asymmetric padding independently from all four sides', () => {
    expect(alphaBounds(imageFixture(12, 11, [[1, 4, 255], [7, 8, 255]])))
      .toEqual({ x: 1, y: 4, width: 7, height: 5 });
  });
});

describe('transparent canvas cropping', () => {
  it('copies the cropped region at its original resolution and preserves every RGBA value', () => {
    const image = imageFixture(8, 7, [[2, 3, 1], [4, 3, 255], [3, 4, 80], [2, 5, 190]]);
    const originalPixels = image.data.slice();
    const { canvas, cropped, pixels } = canvasFixture(image);
    expect(cropTransparentCanvas(canvas)).toBe(cropped);
    expect([cropped.width, cropped.height]).toEqual([3, 3]);
    const expectedPixels = new Uint8ClampedArray(3 * 3 * 4);
    for (let y = 0; y < 3; y++) {
      expectedPixels.set(image.data.subarray(((y + 3) * 8 + 2) * 4, ((y + 3) * 8 + 5) * 4), y * 3 * 4);
    }
    expect(pixels()).toEqual(expectedPixels);
    expect(image.data).toEqual(originalPixels);
    expect([canvas.width, canvas.height]).toEqual([8, 7]);
  });

  it('keeps the original canvas when content already reaches all four boundaries', () => {
    const { canvas } = canvasFixture(imageFixture(5, 4, [[0, 3, 1], [4, 0, 255]]));
    expect(cropTransparentCanvas(canvas)).toBe(canvas);
  });

  it('keeps a fully transparent canvas exportable at its original dimensions', () => {
    const { canvas } = canvasFixture(imageFixture(5, 4));
    expect(cropTransparentCanvas(canvas)).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([5, 4]);
  });

  it.each([[0, 4], [5, 0], [0, 0]])('safely leaves an empty %s by %s canvas unchanged', (width, height) => {
    const canvas = { width, height, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(cropTransparentCanvas(canvas)).toBe(canvas);
  });

  it('reports when the source image cannot be read', () => {
    const canvas = { width: 2, height: 2, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => cropTransparentCanvas(canvas)).toThrow('Could not read the PNG image for cropping.');
  });

  it('reports when a cropped image cannot be created', () => {
    const { canvas } = canvasFixture(imageFixture(3, 3, [[1, 1, 255]]));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(() => cropTransparentCanvas(canvas)).toThrow('Could not create the cropped PNG image.');
  });
});

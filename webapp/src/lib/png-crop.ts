interface PixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function alphaBounds(image: Pick<ImageData, 'data' | 'width' | 'height'>): PixelBounds | null {
  const { data, width, height } = image;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function cropTransparentCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (canvas.width === 0 || canvas.height === 0) return canvas;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not read the PNG image for cropping.');
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const bounds = alphaBounds(image);
  if (!bounds || (bounds.width === canvas.width && bounds.height === canvas.height)) return canvas;

  const cropped = document.createElement('canvas');
  cropped.width = bounds.width;
  cropped.height = bounds.height;
  const croppedContext = cropped.getContext('2d');
  if (!croppedContext) throw new Error('Could not create the cropped PNG image.');
  croppedContext.putImageData(image, -bounds.x, -bounds.y, bounds.x, bounds.y, bounds.width, bounds.height);
  return cropped;
}

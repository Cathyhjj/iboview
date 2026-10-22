type Vec3 = [number, number, number];
type Weights = [number, number, number, number];

function weights(t: number): Weights {
  const t2 = t * t, t3 = t2 * t;
  return [-0.5 * t + t2 - 0.5 * t3, 1 - 2.5 * t2 + 1.5 * t3,
    0.5 * t + 2 * t2 - 1.5 * t3, -0.5 * t2 + 0.5 * t3];
}

function derivatives(t: number): Weights {
  const t2 = t * t;
  return [-0.5 + 2 * t - 1.5 * t2, -5 * t + 4.5 * t2,
    0.5 + 4 * t - 4.5 * t2, -t + 1.5 * t2];
}

/** Interpolates Cube samples without changing their values at grid nodes. */
export class CubicScalarGrid {
  private readonly ny: number;
  private readonly nz: number;
  private readonly strideX: number;

  constructor(readonly dimensions: Vec3, readonly values: Float64Array) {
    this.ny = dimensions[1]; this.nz = dimensions[2]; this.strideX = this.ny * this.nz;
  }

  private extrapolated(x: number, y: number, z: number): number {
    const [nx, ny, nz] = this.dimensions;
    if (x < 0) return 2 * this.extrapolated(0, y, z) - this.extrapolated(Math.min(1, nx - 1), y, z);
    if (x >= nx) return 2 * this.extrapolated(nx - 1, y, z) - this.extrapolated(Math.max(0, nx - 2), y, z);
    if (y < 0) return 2 * this.extrapolated(x, 0, z) - this.extrapolated(x, Math.min(1, ny - 1), z);
    if (y >= ny) return 2 * this.extrapolated(x, ny - 1, z) - this.extrapolated(x, Math.max(0, ny - 2), z);
    if (z < 0) return 2 * this.extrapolated(x, y, 0) - this.extrapolated(x, y, Math.min(1, nz - 1));
    if (z >= nz) return 2 * this.extrapolated(x, y, nz - 1) - this.extrapolated(x, y, Math.max(0, nz - 2));
    return this.values[x * this.strideX + y * this.nz + z];
  }

  stencil(x: number, y: number, z: number, output = new Float64Array(64)): Float64Array {
    let index = 0;
    const [nx, ny, nz] = this.dimensions;
    const interior = x > 0 && x < nx - 2 && y > 0 && y < ny - 2 && z > 0 && z < nz - 2;
    for (let dx = -1; dx <= 2; dx += 1) {
      for (let dy = -1; dy <= 2; dy += 1) {
        const base = (x + dx) * this.strideX + (y + dy) * this.nz + z;
        for (let dz = -1; dz <= 2; dz += 1) {
          output[index++] = interior ? this.values[base + dz] : this.extrapolated(x + dx, y + dy, z + dz);
        }
      }
    }
    return output;
  }

  sample(stencil: Float64Array, x: number, y: number, z: number): [number, number, number, number] {
    const wx = weights(x), wy = weights(y), wz = weights(z);
    const dx = derivatives(x), dy = derivatives(y), dz = derivatives(z);
    let value = 0, gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        let row = 0, derivative = 0;
        const base = i * 16 + j * 4;
        for (let k = 0; k < 4; k += 1) {
          row += stencil[base + k] * wz[k];
          derivative += stencil[base + k] * dz[k];
        }
        value += row * wx[i] * wy[j];
        gx += row * dx[i] * wy[j];
        gy += row * wx[i] * dy[j];
        gz += derivative * wx[i] * wy[j];
      }
    }
    return [value, gx, gy, gz];
  }

  subdivide(stencil: Float64Array, factor: number, output: Float64Array): void {
    const n = factor + 1;
    const basis = Array.from({ length: n }, (_, index) => weights(index / factor));
    const alongX = new Float64Array(n * 16), alongY = new Float64Array(n * n * 4);
    for (let x = 0; x < n; x += 1) {
      for (let yz = 0; yz < 16; yz += 1) {
        for (let i = 0; i < 4; i += 1) alongX[x * 16 + yz] += basis[x][i] * stencil[i * 16 + yz];
      }
      for (let y = 0; y < n; y += 1) {
        for (let z = 0; z < 4; z += 1) {
          const target = (x * n + y) * 4 + z;
          for (let j = 0; j < 4; j += 1) alongY[target] += basis[y][j] * alongX[x * 16 + j * 4 + z];
        }
        for (let z = 0; z < n; z += 1) {
          const target = (x * n + y) * n + z;
          output[target] = 0;
          for (let k = 0; k < 4; k += 1) output[target] += basis[z][k] * alongY[(x * n + y) * 4 + k];
        }
      }
    }
  }
}

/** A tensor Catmull–Rom patch has total negative weight at most (1.25^3 - 1) / 2. */
export function cubicRange(stencil: Float64Array): [number, number] {
  let low = Infinity, high = -Infinity;
  for (const value of stencil) { low = Math.min(low, value); high = Math.max(high, value); }
  const overshoot = 0.4765625 * (high - low);
  return [low - overshoot, high + overshoot];
}

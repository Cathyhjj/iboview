import { describe, expect, it } from 'vitest';
import { parseCube } from '../src/lib/importers';
import { buildOrbital, type MeshData } from '../src/render/geometry';
import { CubicScalarGrid, cubicRange } from '../src/render/cubic-grid';

type Vec3 = [number, number, number];
function cube(dimensions: Vec3, origin: Vec3, axes: Vec3[], field: (p: Vec3) => number) {
  const values: number[] = [];
  for (let x = 0; x < dimensions[0]; x++) for (let y = 0; y < dimensions[1]; y++) for (let z = 0; z < dimensions[2]; z++) {
    values.push(field([0, 1, 2].map(i => origin[i] + x * axes[0][i] + y * axes[1][i] + z * axes[2][i]) as Vec3));
  }
  return parseCube(['Refinement fixture', 'Angstrom coordinates', `1 ${origin.join(' ')}`,
    ...axes.map((axis, i) => `${-dimensions[i]} ${axis.join(' ')}`), '6 6 0 0 0', values.join(' '),
  ].join('\n'));
}

function edges(mesh: MeshData) {
  const result = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < mesh.indices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = mesh.indices[i + j], b = mesh.indices[i + (j + 1) % 3];
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    const edge = result.get(key);
    if (edge) edge.count++; else result.set(key, { a, b, count: 1 });
  }
  return [...result.values()];
}

function sphereError(mesh: MeshData, radius: number) {
  let total = 0, count = 0, longestEdge = 0;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    total += Math.abs(Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]) - radius);
    count++;
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const vertices = Array.from(mesh.indices.slice(i, i + 3));
    const center = [0, 1, 2].map(axis => vertices.reduce((sum, vertex) => sum + mesh.positions[vertex * 3 + axis] / 3, 0));
    total += Math.abs(Math.hypot(...center) - radius);
    count++;
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge], b = vertices[(edge + 1) % 3];
      longestEdge = Math.max(longestEdge, Math.hypot(...[0, 1, 2].map(axis => mesh.positions[a * 3 + axis] - mesh.positions[b * 3 + axis])));
    }
  }
  return { mean: total / count, longestEdge };
}

describe('refined orbital contours', () => {
  it('retains source samples exactly and agrees across neighboring cubic patches', () => {
    const dimensions: Vec3 = [6, 6, 6];
    const values = Float64Array.from({ length: 216 }, (_, index) => Math.sin(index * 2.13));
    const grid = new CubicScalarGrid(dimensions, values);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) for (let z = 0; z < 5; z++) {
      const stencil = grid.stencil(x, y, z);
      for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
        expect(grid.sample(stencil, dx, dy, dz)[0]).toBe(values[((x + dx) * 6 + y + dy) * 6 + z + dz]);
      }
      if (x < 4) {
        const left = grid.sample(stencil, 1, .31, .67);
        const right = grid.sample(grid.stencil(x + 1, y, z), 0, .31, .67);
        for (let component = 0; component < 4; component++) expect(left[component]).toBeCloseTo(right[component], 12);
      }
    }
    const stencil = grid.stencil(2, 2, 2), at: Vec3 = [.37, .51, .63];
    const sample = grid.sample(stencil, ...at), epsilon = 1e-5;
    for (let axis = 0; axis < 3; axis++) {
      const plus = [...at] as Vec3, minus = [...at] as Vec3;
      plus[axis] += epsilon; minus[axis] -= epsilon;
      expect(sample[axis + 1]).toBeCloseTo((grid.sample(stencil, ...plus)[0] - grid.sample(stencil, ...minus)[0]) / (2 * epsilon), 7);
    }
    const [low, high] = cubicRange(stencil);
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) for (let z = 0; z <= 10; z++) {
      const value = grid.sample(stencil, x / 10, y / 10, z / 10)[0];
      expect(value).toBeGreaterThanOrEqual(low);
      expect(value).toBeLessThanOrEqual(high);
    }
  });

  it.each([1, -1])('reduces signed Gaussian sphere position and triangle chord error (%s)', sign => {
    const parsed = cube([17, 17, 17], [-2, -2, -2], [[.25, 0, 0], [0, .25, 0], [0, 0, .25]],
      ([x, y, z]) => sign * Math.exp(-x * x - y * y - z * z));
    const originalText = parsed.cube;
    const native = buildOrbital(parsed, .3, 1), refined = buildOrbital(parsed, .3);
    const radius = Math.sqrt(-Math.log(.3));
    const before = sphereError(native, radius), after = sphereError(refined, radius);
    expect(after.mean).toBeLessThan(before.mean * .4);
    expect(after.longestEdge).toBeLessThan(before.longestEdge * .45);
    expect(edges(refined).every(edge => edge.count === 2)).toBe(true);
    expect(refined.positions.every(Number.isFinite)).toBe(true);
    expect(refined.normals.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < refined.positions.length; i += 3) {
      const p = refined.positions.slice(i, i + 3), n = refined.normals.slice(i, i + 3);
      expect(Math.hypot(...n)).toBeCloseTo(1, 6);
      expect((p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) / Math.hypot(...p)).toBeGreaterThan(.99);
    }
    expect(parsed.cube).toBe(originalText);
  });

  it.each([1, -1])('retains affine fields and outward normals on skew grids with handedness %s', handedness => {
    const axes: Vec3[] = [[.3 * handedness, .07, 0], [.04, .3, .02], [.05, 0, .3]];
    const normal = [1.2, -.3, .7], length = Math.hypot(...normal);
    const parsed = cube([8, 8, 8], [handedness > 0 ? -1 : 1, -1, -1], axes,
      p => p.reduce((sum, v, i) => sum + v * normal[i], 0));
    const mesh = buildOrbital(parsed, .3);
    expect(mesh.indices.length).toBeGreaterThan(0);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const value = normal.reduce((sum, v, axis) => sum + v * mesh.positions[i + axis], 0);
      const alignment = normal.reduce((sum, v, axis) => sum + v * mesh.normals[i + axis] / length, 0);
      expect(Math.abs(value)).toBeCloseTo(.3, 6);
      expect(alignment).toBeCloseTo(-Math.sign(value), 6);
    }
  });

  it('includes cubic crossings without nodal sign changes and shares every interior edge', () => {
    const samples = [0, 0, .92, .92, 0, 0, 1.2, 0];
    const parsed = cube([8, 5, 5], [0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ([x]) => samples[x]);
    const mesh = buildOrbital(parsed, .98);
    expect(mesh.positions.some((value, i) => i % 3 === 0 && value > 2 && value < 3)).toBe(true);
    for (const edge of edges(mesh)) {
      expect(edge.count).toBeLessThanOrEqual(2);
      if (edge.count === 2) continue;
      const onBoundary = [1, 2].some(axis => [0, 4].some(boundary =>
        Math.abs(mesh.positions[edge.a * 3 + axis] - boundary) < 1e-6
        && Math.abs(mesh.positions[edge.b * 3 + axis] - boundary) < 1e-6));
      expect(onBoundary).toBe(true);
    }
  });
});

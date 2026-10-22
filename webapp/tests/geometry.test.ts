import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCube, parseXYZ } from '../src/lib/importers';
import { buildMolecule, buildOrbital, recolorOrbital, type MeshData, type OrbitalMeshData } from '../src/render/geometry';
import { buildOrbitalTailCoordinates, buildOrbitalTailWeights, orbitalTailWeight } from '../src/render/orbital-tail';

type Vec3 = [number, number, number];
const BOHR = 0.52917721092;
const dot = (a: number[], b: number[]): number => a.reduce((value, component, i) => value + component * b[i], 0);

function cube(dimensions: Vec3, origin: Vec3, axes: Vec3[], field: (point: Vec3) => number) {
  const values: number[] = [];
  for (let x = 0; x < dimensions[0]; x += 1) for (let y = 0; y < dimensions[1]; y += 1) for (let z = 0; z < dimensions[2]; z += 1) {
    const point = [0, 1, 2].map((axis) => origin[axis] + x * axes[0][axis] + y * axes[1][axis] + z * axes[2][axis]) as Vec3;
    values.push(field(point));
  }
  return parseCube(['Analytic geometry fixture', 'Coordinates in angstroms', `1 ${origin.join(' ')}`,
    ...axes.map((axis, i) => `${-dimensions[i]} ${axis.join(' ')}`), '6 6 0 0 0', values.join(' '),
  ].join('\n'));
}

function assertMesh(mesh: MeshData): void {
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.colors.length).toBe(mesh.positions.length / 3 * 4);
  expect(mesh.indices.length % 3).toBe(0);
  expect(mesh.positions.every(Number.isFinite)).toBe(true);
  expect(mesh.normals.every(Number.isFinite)).toBe(true);
  expect(mesh.colors.every(Number.isFinite)).toBe(true);
  expect(mesh.indices.every((index) => index < mesh.positions.length / 3)).toBe(true);
  let worstLengthError = 0;
  for (let index = 0; index < mesh.normals.length; index += 3) {
    worstLengthError = Math.max(worstLengthError, Math.abs(Math.hypot(...mesh.normals.slice(index, index + 3)) - 1));
  }
  expect(worstLengthError).toBeLessThan(1e-6);
}

function assertWinding(mesh: MeshData): void {
  let minimumAlignment = Infinity;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [a, b, c] = mesh.indices.slice(index, index + 3);
    const ab = [0, 1, 2].map((axis) => mesh.positions[b * 3 + axis] - mesh.positions[a * 3 + axis]);
    const ac = [0, 1, 2].map((axis) => mesh.positions[c * 3 + axis] - mesh.positions[a * 3 + axis]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const average = [0, 1, 2].map((axis) => mesh.normals[a * 3 + axis] + mesh.normals[b * 3 + axis] + mesh.normals[c * 3 + axis]);
    if (Math.hypot(...normal) > 1e-12) minimumAlignment = Math.min(minimumAlignment, dot(normal, average));
  }
  expect(minimumAlignment).toBeGreaterThan(0);
}

describe('native IboView molecule geometry', () => {
  it('uses native subdivision level 3, atom radius, carbon gray, and outward winding', () => {
    const mesh = buildMolecule([{ element: 'C', x: 0, y: 0, z: 0 }], { hydrogens: true, style: 'ball-stick' });
    expect(mesh.positions.length / 3).toBe(642);
    expect(mesh.indices.length / 3).toBe(1280);
    expect(Math.hypot(...mesh.positions.slice(0, 3))).toBeCloseTo(0.4 * 1.43 * BOHR, 7);
    expect(Array.from(mesh.colors.slice(0, 4))).toEqual([Math.fround(0.6), Math.fround(0.6), Math.fround(0.6), 1]);
    assertMesh(mesh);
    assertWinding(mesh);
  });

  it('detects the two water bonds, colors each half, and hides hydrogen geometry', () => {
    const atoms = parseXYZ('3\nWater\nO 0 0 0\nH .757 .586 0\nH -.757 .586 0').atoms;
    const mesh = buildMolecule(atoms, { hydrogens: true, style: 'ball-stick' });
    expect(mesh.positions.length / 3).toBe(3 * 642 + 4 * 32);
    expect(mesh.indices.length / 3).toBe(3 * 1280 + 4 * 32);
    assertMesh(mesh);
    assertWinding(mesh);
    const hidden = buildMolecule(atoms, { hydrogens: false, style: 'ball-stick' });
    expect(hidden.positions.length / 3).toBe(642);
  });

  it('uses native covalent cutoff and supports stick and van der Waals representations', () => {
    const cutoff = 1.3 * 2 * 1.4551 * BOHR;
    const atoms = [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'C', x: cutoff - 1e-5, y: 0, z: 0 }];
    const stick = buildMolecule(atoms, { hydrogens: true, style: 'stick' });
    expect(stick.positions.length / 3).toBe(2 * 642 + 2 * 32);
    expect(Math.hypot(...stick.positions.slice(0, 3))).toBeCloseTo(0.28 * BOHR, 7);
    assertWinding(stick);
    atoms[1].x = cutoff + 1e-5;
    expect(buildMolecule(atoms, { hydrogens: true, style: 'ball-stick' }).positions.length / 3).toBe(2 * 642);
    const filled = buildMolecule(atoms, { hydrogens: true, style: 'space-fill' });
    expect(filled.positions.length / 3).toBe(2 * 642);
    expect(Math.hypot(...filled.positions.slice(0, 3))).toBeCloseTo(3.2125 * BOHR, 7);
  });
});

describe('native IboView isosurface geometry', () => {
  it.each([0, 1, -1])('caches independent lobe tails and recolors without geometry changes for field mode %s', (mode) => {
    const field = ([x, y, z]: Vec3) => {
      const right = Math.exp(-((x - 2) ** 2) - y * y - z * z);
      const left = Math.exp(-((x + 2) ** 2) - y * y - z * z);
      return mode === 0 ? right - left : mode * (right + left);
    };
    const mesh = buildOrbital(cube([29, 17, 17], [-3.5, -2, -2], [[0.25, 0, 0], [0, 0.25, 0], [0, 0, 0.25]], field), 0.3);
    const positions = mesh.positions.slice(), normals = mesh.normals.slice(), indices = mesh.indices.slice();
    const weights = mesh.tailWeights!, cachedWeights = weights.slice();
    const coordinates = mesh.tailCoordinates!, cachedCoordinates = coordinates.slice();
    const original = { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, colors: mesh.colors };
    expect(weights.length).toBe(mesh.positions.length / 3);
    expect(weights.every((weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1)).toBe(true);
    for (const side of [1, -1]) {
      const sideWeights = weights.filter((_, vertex) => Math.sign(mesh.positions[vertex * 3]) === side);
      expect(sideWeights.some((weight) => weight > 0)).toBe(true);
      expect(sideWeights.some((weight) => weight === 0)).toBe(true);
    }
    mesh.colors[3] = 0.37;
    const ramp = { positive: ['#440000', '#880000', '#cc0000'], negative: ['#000044', '#000088', '#0000cc'] };
    recolorOrbital(mesh, '#440000', '#000044', ramp);
    for (let vertex = 0; vertex < weights.length; vertex += 1) {
      const point = Array.from(mesh.positions.slice(vertex * 3, vertex * 3 + 3)) as Vec3;
      const positive = field(point) > 0;
      const expected = (0x44 + 0x88 * weights[vertex]) / 255;
      expect(mesh.colors[vertex * 4 + (positive ? 0 : 2)]).toBeCloseTo(expected, 6);
      expect(mesh.colors[vertex * 4 + (positive ? 2 : 0)]).toBe(0);
      expect(mesh.colors[vertex * 4 + 1]).toBe(0);
    }
    expect(mesh.colors[3]).toBe(Math.fround(0.37));
    expect(mesh.positions).toBe(original.positions);
    expect(mesh.normals).toBe(original.normals);
    expect(mesh.indices).toBe(original.indices);
    expect(mesh.colors).toBe(original.colors);
    expect(mesh.positions).toEqual(positions);
    expect(mesh.normals).toEqual(normals);
    expect(mesh.indices).toEqual(indices);
    expect(mesh.tailWeights).toBe(weights);
    expect(mesh.tailWeights).toEqual(cachedWeights);
    expect(mesh.tailCoordinates).toBe(coordinates);
    expect(mesh.tailCoordinates).toEqual(cachedCoordinates);
    recolorOrbital(mesh, '#440000', '#000044');
    for (let vertex = 0; vertex < weights.length; vertex += 1) {
      expect(mesh.colors[vertex * 4 + (vertex < mesh.positiveVertexCount ? 0 : 2)]).toBe(Math.fround(0x44 / 255));
    }
    expect(mesh.colors[3]).toBe(Math.fround(0.37));
    recolorOrbital(mesh, '#440000', '#000044', { ...ramp, extent: 0 });
    for (let vertex = 0; vertex < weights.length; vertex += 1) {
      expect(mesh.colors[vertex * 4 + (vertex < mesh.positiveVertexCount ? 0 : 2)]).toBe(Math.fround(0x44 / 255));
    }
    recolorOrbital(mesh, '#440000', '#000044', { ...ramp, extent: 1 });
    expect(mesh.colors.some((value, index) => index % 4 !== 3 && value > 0x44 / 255)).toBe(true);
    expect(mesh.tailCoordinates).toBe(coordinates);
    expect(mesh.tailCoordinates).toEqual(cachedCoordinates);
    expect(mesh.positions).toEqual(positions);
    expect(mesh.normals).toEqual(normals);
    expect(mesh.indices).toEqual(indices);
  });

  it.each([0, 1, -1])('recolors signed surfaces without changing topology or normals for field mode %s', (mode) => {
    const field = ([x]: Vec3) => mode === 0 ? x : mode * Math.abs(x);
    const parsed = cube([3, 3, 3], [-1, -1, -1], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], field);
    const mesh = buildOrbital(parsed, 0.4);
    const original = { positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, colors: mesh.colors };
    const positions = mesh.positions.slice(), normals = mesh.normals.slice(), indices = mesh.indices.slice();
    expect(mesh.positiveVertexCount).toBe(mode === -1 ? 0 : mode === 1 ? 18 : 9);
    for (const [positive, negative] of [['#003366', '#cc2200'], ['#ffffff', '#000000']]) {
      recolorOrbital(mesh, positive, negative);
      for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
        const point = Array.from(mesh.positions.slice(vertex * 3, vertex * 3 + 3)) as Vec3;
        const hex = field(point) > 0 ? positive : negative;
        const expected = [1, 3, 5].map((offset) => Math.fround(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255));
        expect(Array.from(mesh.colors.slice(vertex * 4, vertex * 4 + 4))).toEqual([...expected, 1]);
      }
      expect(mesh.positions).toBe(original.positions);
      expect(mesh.normals).toBe(original.normals);
      expect(mesh.indices).toBe(original.indices);
      expect(mesh.colors).toBe(original.colors);
      expect(mesh.positions).toEqual(positions);
      expect(mesh.normals).toEqual(normals);
      expect(mesh.indices).toEqual(indices);
      assertWinding(mesh);
    }
    const colors = mesh.colors.slice();
    expect(() => recolorOrbital(mesh, '#ff0000', 'invalid')).toThrow(/hexadecimal/);
    expect(mesh.colors).toEqual(colors);
  });

  it('preserves the native two-triangle cube face and outward normals for both phases', () => {
    const parsed = cube([3, 3, 3], [-1, -1, -1], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ([x]) => x);
    const mesh = buildOrbital(parsed, 0.4);
    expect(mesh.positions.length / 3).toBe(18);
    expect(mesh.indices.length / 3).toBe(16);
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      const positive = mesh.positions[vertex * 3] > 0;
      expect(mesh.positions[vertex * 3]).toBeCloseTo(positive ? 0.4 : -0.4, 6);
      expect(Array.from(mesh.normals.slice(vertex * 3, vertex * 3 + 3))).toEqual([positive ? -1 : 1, positive ? -0 : 0, positive ? -0 : 0]);
      const expected = positive ? [0x63 / 255, 0x53 / 255, 0xe6 / 255, 1] : [0x24 / 255, 0xc8 / 255, 0xc4 / 255, 1];
      expect(Array.from(mesh.colors.slice(vertex * 4, vertex * 4 + 4))).toEqual(expected.map(Math.fround));
    }
    assertMesh(mesh);
    assertWinding(mesh);
  });

  it.each([1, -1])('orients a Gaussian sphere outwards for signed amplitude %s', (sign) => {
    const parsed = cube([17, 17, 17], [-2, -2, -2], [[0.25, 0, 0], [0, 0.25, 0], [0, 0, 0.25]], ([x, y, z]) => sign * Math.exp(-x*x-y*y-z*z));
    const mesh = buildOrbital(parsed, 0.3);
    expect(mesh.indices.length).toBeGreaterThan(100);
    let worstRadialAlignment = 1;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      const p = Array.from(mesh.positions.slice(vertex * 3, vertex * 3 + 3));
      const n = Array.from(mesh.normals.slice(vertex * 3, vertex * 3 + 3));
      worstRadialAlignment = Math.min(worstRadialAlignment, dot(p, n) / Math.hypot(...p));
    }
    expect(worstRadialAlignment).toBeGreaterThan(0.99);
    expect(mesh.tailWeights!.every((weight) => weight === 0)).toBe(true);
    assertMesh(mesh);
    assertWinding(mesh);
  });

  it.each([1, -1])('uses an inverse-transpose gradient and correct winding for skew grid handedness %s', (handedness) => {
    const axes: Vec3[] = [[0.3 * handedness, 0.07, 0], [0.04, 0.3, 0.02], [0.05, 0, 0.3]];
    const expected = [1.2, -0.3, 0.7];
    const parsed = cube([8, 8, 8], [handedness > 0 ? -1 : 1, -1, -1], axes, (p) => dot(p, expected));
    const mesh = buildOrbital(parsed, 0.3);
    expect(mesh.indices.length).toBeGreaterThan(50);
    let worstPositionError = 0, worstNormalError = 0;
    for (let vertex = 0; vertex < mesh.positions.length / 3; vertex += 1) {
      const p = Array.from(mesh.positions.slice(vertex * 3, vertex * 3 + 3));
      const n = Array.from(mesh.normals.slice(vertex * 3, vertex * 3 + 3));
      const sign = dot(p, expected) > 0 ? 1 : -1;
      worstPositionError = Math.max(worstPositionError, Math.abs(dot(p, expected) - sign * 0.3));
      worstNormalError = Math.max(worstNormalError, Math.abs(dot(n, expected) / Math.hypot(...expected) + sign));
    }
    expect(worstPositionError).toBeLessThan(1e-6);
    expect(worstNormalError).toBeLessThan(1e-6);
    assertMesh(mesh);
    assertWinding(mesh);
  });

  it('returns empty geometry outside the field range or with a one-point grid dimension', () => {
    const parsed = cube([1, 2, 2], [0, 0, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]], ([, y, z]) => y-z);
    expect(buildOrbital(parsed, 0.5).indices).toHaveLength(0);
    expect(buildOrbital(parsed, 4).indices).toHaveLength(0);
    expect(() => buildOrbital(parsed, 0)).toThrow(/positive finite/);
    expect(() => buildOrbital(parsed, NaN)).toThrow(/positive finite/);
  });

  it.each(['ibo-07', 'ibo-13', 'ibo-19', 'ibo-20', 'ibo-21'])('builds finite, indexed, both-phase geometry for the real benzene %s demo', (name) => {
    const parsed = parseCube(readFileSync(new URL(`../public/data/benzene/${name}.cube`, import.meta.url), 'utf8'));
    const mesh = buildOrbital(parsed, 0.045);
    assertMesh(mesh);
    expect(mesh.indices.length).toBeGreaterThan(300);
    expect(mesh.colors.some((value, index) => index % 4 === 0 && value === Math.fround(0x63 / 255))).toBe(true);
    expect(mesh.colors.some((value, index) => index % 4 === 0 && value === Math.fround(0x24 / 255))).toBe(true);
  });
});

describe('orbital lobe tail weights', () => {
  const atoms = [{ element: 'C', x: 0, y: 0, z: 0 }];

  it('starts at 80% of each disconnected lobe and remains unchanged by rigid motion', () => {
    const positions: number[] = [], indices: number[] = [];
    const samples = [0, 0.2, 0.5, 0.8, 0.9, 1];
    for (const [axis, sign, length] of [[0, 1, 10], [0, -1, 3], [1, 1, 5]]) {
      const start = positions.length / 3;
      for (const sample of samples) {
        for (const side of [-1, 1]) {
          const point = [0, 0, 0];
          point[axis] = sign * (1 + sample * length);
          point[(axis + 1) % 3] = side * 0.1;
          positions.push(...point);
        }
      }
      for (let index = 0; index < samples.length - 1; index += 1) {
        const base = start + index * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const array = new Float32Array(positions), faces = new Uint32Array(indices);
    const weights = buildOrbitalTailWeights(array, faces, 24, atoms);
    for (let lobe = 0; lobe < 3; lobe += 1) {
      for (let index = 0; index < 12; index += 1) {
        const expected = index < 8 ? 0 : index < 10 ? 0.5 : 1;
        expect(weights[lobe * 12 + index]).toBeCloseTo(expected, 5);
      }
    }
    const coordinates = buildOrbitalTailCoordinates(array, faces, 24, atoms);
    for (let lobe = 0; lobe < 3; lobe += 1) {
      for (let index = 0; index < 12; index += 1) {
        expect(coordinates[lobe * 12 + index]).toBeCloseTo(samples[Math.floor(index / 2)], 5);
      }
    }
    expect(buildOrbitalTailWeights(array, faces, 24, atoms, 0).every((weight) => weight === 0)).toBe(true);
    const full = buildOrbitalTailWeights(array, faces, 24, atoms, 1);
    for (let lobe = 0; lobe < 3; lobe += 1) {
      for (let index = 0; index < 12; index += 1) {
        expect(full[lobe * 12 + index]).toBeCloseTo([0, 0.104, 0.5, 0.896, 0.972, 1][Math.floor(index / 2)], 5);
      }
    }
    const moved = new Float32Array(positions.length);
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      moved.set([positions[vertex * 3 + 2] + 2, positions[vertex * 3] - 3, positions[vertex * 3 + 1] + 1], vertex * 3);
    }
    const movedWeights = buildOrbitalTailWeights(moved, faces, 24, [{ element: 'C', x: 2, y: -3, z: 1 }]);
    weights.forEach((weight, vertex) => expect(movedWeights[vertex]).toBeCloseTo(weight, 5));
  });

  it('keeps centered, flat, degenerate, and empty surfaces finite and uniform', () => {
    const faces = new Uint32Array([0, 1, 2]);
    for (const positions of [
      [0, -1, -1, 0, 1, -1, 0, 0, 2],
      [2, -1, -1, 2, 1, -1, 2, 0, 2],
      [1, 0, 0, 2, 0, 0, 3, 0, 0],
    ]) {
      const array = new Float32Array(positions);
      expect(Array.from(buildOrbitalTailCoordinates(array, faces, 3, atoms))).toEqual([-1, -1, -1]);
      expect(Array.from(buildOrbitalTailWeights(array, faces, 3, atoms))).toEqual([0, 0, 0]);
      expect(Array.from(buildOrbitalTailWeights(array, faces, 3, atoms, 1))).toEqual([0, 0, 0]);
    }
    expect(buildOrbitalTailWeights(new Float32Array(), new Uint32Array(), 0, atoms)).toHaveLength(0);
  });

  it('supports meshes without cached tails and never changes alpha', () => {
    const mesh: OrbitalMeshData = {
      positions: new Float32Array(6), normals: new Float32Array(6), indices: new Uint32Array(),
      colors: new Float32Array([0, 0, 0, 0.25, 0, 0, 0, 0.75]), positiveVertexCount: 1,
    };
    recolorOrbital(mesh, '#ff0000', '#0000ff', { positive: ['#ff0000', '#00ff00'], negative: ['#0000ff', '#ffff00'] });
    expect(Array.from(mesh.colors)).toEqual([1, 0, 0, 0.25, 0, 0, 1, 0.75]);
  });

  it('changes spatial extent using cached coordinates while preserving both phases and mesh buffers', () => {
    const mesh: OrbitalMeshData = {
      positions: Float32Array.from({ length: 36 }, (_, index) => index / 10),
      normals: new Float32Array(36).fill(1), indices: new Uint32Array([0, 1, 2, 6, 7, 8]),
      colors: Float32Array.from({ length: 48 }, (_, index) => index % 4 === 3 ? 0.25 : 0),
      positiveVertexCount: 6, tailCoordinates: new Float32Array([0, 0.5, 0.8, 0.9, 1, -1, 0, 0.5, 0.8, 0.9, 1, -1]),
    };
    const arrays = [mesh.positions, mesh.normals, mesh.indices, mesh.tailCoordinates!];
    const original = arrays.map((array) => array.slice());
    const colorBuffer = mesh.colors;
    const ramp = { positive: ['#000000', '#ff0000'], negative: ['#000000', '#0000ff'] };
    for (const [extent, expected] of [
      [0, [0, 0, 0, 0, 0, 0]],
      [0.2, [0, 0, 0, 0.5, 1, 0]],
      [0.5, [0, 0, 0.648, 0.896, 1, 0]],
      [1, [0, 0.5, 0.896, 0.972, 1, 0]],
    ] as const) {
      recolorOrbital(mesh, '#000000', '#000000', { ...ramp, extent });
      for (let vertex = 0; vertex < 12; vertex += 1) {
        const phaseChannel = vertex < 6 ? 0 : 2;
        expect(mesh.colors[vertex * 4 + phaseChannel]).toBeCloseTo(expected[vertex % 6], 5);
        expect(mesh.colors[vertex * 4 + (2 - phaseChannel)]).toBe(0);
        expect(mesh.colors[vertex * 4 + 3]).toBe(0.25);
      }
      expect(mesh.colors).toBe(colorBuffer);
      [mesh.positions, mesh.normals, mesh.indices, mesh.tailCoordinates!].forEach((array, index) => {
        expect(array).toBe(arrays[index]);
        expect(array).toEqual(original[index]);
      });
    }
    expect(orbitalTailWeight(-1, 1)).toBe(0);
    expect(orbitalTailWeight(NaN, 1)).toBe(0);
    expect(orbitalTailWeight(1, -1)).toBe(0);
    expect(orbitalTailWeight(0.5, 2)).toBe(0.5);
    expect(orbitalTailWeight(0.9, NaN)).toBeCloseTo(0.5);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCube, parseXYZ } from '../src/lib/importers';
import { buildMolecule, buildOrbital, type MeshData } from '../src/render/geometry';

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

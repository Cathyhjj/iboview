import { describe, expect, it } from 'vitest';
import type { Atom } from '../src/lib/importers';
import { DEFAULT_MOLECULE_APPEARANCE, type MoleculeAppearance } from '../src/lib/molecule-appearance';
import { buildMolecule, type MeshData } from '../src/render/geometry';

const BOHR = 0.52917721092;
const SPHERE_VERTICES = 642;
const PAIR: Atom[] = [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'O', x: 1.2, y: 0, z: 0 }];
const OPTIONS = { hydrogens: true, style: 'ball-stick' } as const;
const rgba = (hex: number) => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255, 1].map(Math.fround);
const vertexColor = (mesh: MeshData, vertex: number) => Array.from(mesh.colors.slice(vertex * 4, vertex * 4 + 4));
const sphereRadius = (mesh: MeshData, atom: Atom, index: number) => Math.hypot(
  mesh.positions[index * SPHERE_VERTICES * 3] - atom.x,
  mesh.positions[index * SPHERE_VERTICES * 3 + 1] - atom.y,
  mesh.positions[index * SPHERE_VERTICES * 3 + 2] - atom.z,
);
const ringRadius = (mesh: MeshData, atomCount: number, ring: number) => {
  const offset = (atomCount * SPHERE_VERTICES + ring * 16) * 3;
  return Math.hypot(mesh.positions[offset + 1], mesh.positions[offset + 2]);
};

function assertValidWinding(mesh: MeshData) {
  expect(mesh.positions.every(Number.isFinite)).toBe(true);
  expect(mesh.normals.every(Number.isFinite)).toBe(true);
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const [a, b, c] = Array.from(mesh.indices.slice(index, index + 3), vertex => vertex * 3);
    const ab = [0, 1, 2].map(axis => mesh.positions[b + axis] - mesh.positions[a + axis]);
    const ac = [0, 1, 2].map(axis => mesh.positions[c + axis] - mesh.positions[a + axis]);
    const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    const alignment = normal.reduce((sum, value, axis) => sum + value * mesh.normals[a + axis], 0);
    expect(alignment).toBeGreaterThan(0);
  }
}

describe('molecular appearance geometry', () => {
  it('preserves the native ball-and-stick mesh with explicit default settings', () => {
    const native = buildMolecule(PAIR, OPTIONS);
    expect(buildMolecule(PAIR, DEFAULT_MOLECULE_APPEARANCE)).toEqual(native);
    expect(native.positions.length / 3).toBe(2 * SPHERE_VERTICES + 64);
    expect(sphereRadius(native, PAIR[0], 0)).toBeCloseTo(0.4 * 1.43 * BOHR, 7);
    expect(vertexColor(native, 0)).toEqual(rgba(0x999999));
    expect(vertexColor(native, SPHERE_VERTICES)).toEqual(rgba(0xff0000));
    expect(ringRadius(native, 2, 0)).toBeCloseTo(0.28 * BOHR, 7);
    expect(ringRadius(native, 2, 1)).toBeCloseTo(0.28 * BOHR * 0.72, 7);
  });

  it('scales atoms and hydrogens without changing bonds, coordinates, or connectivity', () => {
    const atoms: Atom[] = [...PAIR, { element: 'H', x: -1, y: 0, z: 0 }];
    const native = buildMolecule(atoms, OPTIONS);
    const resized = buildMolecule(atoms, { ...OPTIONS, atomScale: 1.6, hydrogenScale: 0.6 });
    for (let index = 0; index < atoms.length; index += 1) {
      expect(sphereRadius(resized, atoms[index], index) / sphereRadius(native, atoms[index], index))
        .toBeCloseTo(index === 2 ? 0.96 : 1.6, 6);
    }
    expect(resized.positions.slice(atoms.length * SPHERE_VERTICES * 3))
      .toEqual(native.positions.slice(atoms.length * SPHERE_VERTICES * 3));
    expect(resized.indices).toEqual(native.indices);
    expect(resized.colors).toEqual(native.colors);
    expect(atoms).toEqual([...PAIR, { element: 'H', x: -1, y: 0, z: 0 }]);
  });

  it('changes only bond width when sizing bonds in the ball-and-stick representation', () => {
    const native = buildMolecule(PAIR, OPTIONS);
    const widened = buildMolecule(PAIR, { ...OPTIONS, bondScale: 1.8 });
    expect(widened.positions.slice(0, 2 * SPHERE_VERTICES * 3)).toEqual(native.positions.slice(0, 2 * SPHERE_VERTICES * 3));
    expect(ringRadius(widened, 2, 0) / ringRadius(native, 2, 0)).toBeCloseTo(1.8, 6);
    expect(ringRadius(widened, 2, 1) / ringRadius(native, 2, 1)).toBeCloseTo(1.8, 6);
    expect(widened.indices).toEqual(native.indices);
    assertValidWinding(widened);
  });

  it('uses endpoint colors for each bond half and permits independent uniform bond color', () => {
    const options = { ...OPTIONS, atomPalette: 'uniform', atomColor: '#66aacc', elementColors: { O: '#ee7788' } } as const;
    const element = buildMolecule(PAIR, options);
    expect(vertexColor(element, 0)).toEqual(rgba(0x66aacc));
    expect(vertexColor(element, SPHERE_VERTICES)).toEqual(rgba(0xee7788));
    expect(vertexColor(element, 2 * SPHERE_VERTICES)).toEqual(rgba(0x66aacc));
    expect(vertexColor(element, 2 * SPHERE_VERTICES + 32)).toEqual(rgba(0xee7788));
    const uniform = buildMolecule(PAIR, { ...options, bondColorMode: 'uniform', bondColor: '#226644' });
    expect(uniform.positions).toEqual(element.positions);
    expect(uniform.normals).toEqual(element.normals);
    expect(uniform.indices).toEqual(element.indices);
    expect(vertexColor(uniform, 0)).toEqual(rgba(0x66aacc));
    expect(vertexColor(uniform, SPHERE_VERTICES)).toEqual(rgba(0xee7788));
    for (let vertex = 2 * SPHERE_VERTICES; vertex < uniform.positions.length / 3; vertex += 1) {
      expect(vertexColor(uniform, vertex)).toEqual(rgba(0x226644));
    }
  });

  it('builds separate spheres and allows bonds to be hidden without altering atom geometry', () => {
    const spheres = buildMolecule(PAIR, { ...OPTIONS, style: 'spheres' });
    expect(spheres).toEqual(buildMolecule(PAIR, { ...OPTIONS, bonds: false }));
    expect(spheres.positions.length / 3).toBe(2 * SPHERE_VERTICES);
    const filling = buildMolecule(PAIR, { ...OPTIONS, style: 'space-fill', atomScale: 0.8 });
    expect(filling.positions.length / 3).toBe(2 * SPHERE_VERTICES);
    expect(sphereRadius(filling, PAIR[0], 0)).toBeCloseTo(3.2125 * BOHR * 0.8, 6);
    assertValidWinding(spheres);
  });

  it('draws wireframes as narrow round tubes with matching spherical joints', () => {
    const wire = buildMolecule(PAIR, { ...OPTIONS, style: 'wireframe', bondScale: 1.3, bondStyle: 'tapered' });
    const radius = 0.28 * BOHR * 0.28 * 1.3;
    expect(wire.positions.length / 3).toBe(2 * SPHERE_VERTICES + 64);
    expect(sphereRadius(wire, PAIR[0], 0)).toBeCloseTo(radius, 7);
    expect(ringRadius(wire, 2, 0)).toBeCloseTo(radius, 7);
    expect(ringRadius(wire, 2, 1)).toBeCloseTo(radius, 7);
    expect(radius).toBeLessThan(0.28 * BOHR * 0.4);
    assertValidWinding(wire);
  });

  it.each<MoleculeAppearance['bondStyle']>(['tapered', 'cylinder'])('keeps %s bonds connected at the midpoint', (bondStyle) => {
    const mesh = buildMolecule(PAIR, { ...OPTIONS, bondStyle });
    const start = 2 * SPHERE_VERTICES;
    expect(mesh.positions[(start + 16) * 3]).toBeCloseTo(0.6, 7);
    expect(mesh.positions[(start + 48) * 3]).toBeCloseTo(0.6, 7);
    expect(ringRadius(mesh, 2, 1) / ringRadius(mesh, 2, 0)).toBeCloseTo(bondStyle === 'tapered' ? 0.72 : 1, 6);
    assertValidWinding(mesh);
  });

  it('retains the same covalent-distance criterion at every appearance scale', () => {
    const cutoff = 1.3 * (1.4551 + 1.3795) * BOHR;
    for (const options of [
      { ...OPTIONS, atomScale: 0.4, bondScale: 2, atomPalette: 'vivid' },
      { ...OPTIONS, atomScale: 2, bondScale: 0.25, atomPalette: 'pastel', bondStyle: 'cylinder' },
      { ...OPTIONS, style: 'wireframe', atomScale: 1.5, bondScale: 0.7 },
    ] satisfies (Pick<MoleculeAppearance, 'style' | 'hydrogens'> & Partial<MoleculeAppearance>)[]) {
      const connected = buildMolecule([PAIR[0], { ...PAIR[1], x: cutoff - 0.00001 }], options);
      const disconnected = buildMolecule([PAIR[0], { ...PAIR[1], x: cutoff + 0.00001 }], options);
      expect(connected.positions.length / 3).toBeGreaterThan(2 * SPHERE_VERTICES);
      expect(disconnected.positions.length / 3).toBe(2 * SPHERE_VERTICES);
    }
  });

  it.each(['ball-stick', 'stick', 'wireframe'] as const)('closes exposed %s bond ends when atoms and hydrogens are much smaller than bonds', (style) => {
    const atoms: Atom[] = [PAIR[0], { element: 'H', x: 1, y: 0, z: 0 }];
    const mesh = buildMolecule(atoms, { ...OPTIONS, style, atomScale: 0.4, hydrogenScale: 0.4, bondScale: 2 });
    const atomVertices = 2 * SPHERE_VERTICES;
    const halfBondVertices = 32 + 17;
    expect(mesh.positions.length / 3).toBe(atomVertices + 2 * halfBondVertices);
    for (let half = 0; half < 2; half += 1) {
      const first = atomVertices + half * halfBondVertices;
      const capCenter = first + 32;
      const endpoint = atoms[half].x;
      const direction = half === 0 ? 1 : -1;
      for (let index = 0; index < 16; index += 1) {
        expect(mesh.positions[(first + index) * 3]).toBeCloseTo(endpoint, 7);
        expect(mesh.positions[(first + 16 + index) * 3]).toBeCloseTo(0.5, 7);
        expect(mesh.positions[(capCenter + 1 + index) * 3]).toBeCloseTo(endpoint, 7);
      }
      expect(Array.from(mesh.positions.slice(capCenter * 3, capCenter * 3 + 3))).toEqual([endpoint, 0, 0]);
      expect(mesh.normals[capCenter * 3]).toBe(-direction);
      const capFaces = [];
      for (let index = 0; index < mesh.indices.length; index += 3) {
        if (mesh.indices[index] === capCenter) capFaces.push(Array.from(mesh.indices.slice(index, index + 3)));
      }
      expect(capFaces).toHaveLength(16);
      for (const face of capFaces) expect(face.slice(1).every(vertex => vertex > capCenter && vertex <= capCenter + 16)).toBe(true);
    }
    assertValidWinding(mesh);
  });

  it('reduces sculpted bond offsets to stay inside moderately reduced atoms without adding exposed caps', () => {
    const atoms: Atom[] = [PAIR[0], { element: 'H', x: 1, y: 0, z: 0 }];
    const mesh = buildMolecule(atoms, { ...OPTIONS, hydrogenScale: 0.82 });
    const hydrogenRadius = sphereRadius(mesh, atoms[1], 1);
    const hydrogenBond = 2 * SPHERE_VERTICES + 32;
    const offset = atoms[1].x - mesh.positions[hydrogenBond * 3];
    expect(mesh.positions.length / 3).toBe(2 * SPHERE_VERTICES + 64);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(0.12 * 0.87 * BOHR);
    const rimDistance = Math.hypot(offset, mesh.positions[hydrogenBond * 3 + 1], mesh.positions[hydrogenBond * 3 + 2]);
    expect(rimDistance).toBeLessThan(hydrogenRadius);
    assertValidWinding(mesh);
  });

  it('hides hydrogens and their bonds in every representation', () => {
    const atoms: Atom[] = [PAIR[0], { element: 'H', x: 1, y: 0, z: 0 }];
    for (const style of ['ball-stick', 'stick', 'wireframe', 'spheres', 'space-fill'] as const) {
      const mesh = buildMolecule(atoms, { ...OPTIONS, hydrogens: false, style });
      expect(mesh.positions.length / 3).toBe(SPHERE_VERTICES);
      expect(mesh).toEqual(buildMolecule([PAIR[0]], { ...OPTIONS, hydrogens: false, style }));
    }
  });
});

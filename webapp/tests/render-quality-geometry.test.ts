import { describe, expect, it } from 'vitest';
import { parseCube, type Atom } from '../src/lib/importers';
import { DEFAULT_RENDER_QUALITY, RENDER_QUALITY_SETTINGS, type RenderQuality } from '../src/lib/render-quality';
import { buildMolecule, buildOrbital, type MeshData } from '../src/render/geometry';

const QUALITIES: RenderQuality[] = ['fast', 'balanced', 'smooth'];
const BOHR = .52917721092;
const OPTIONS = { hydrogens: true, style: 'ball-stick' } as const;
const PAIR: Atom[] = [{ element: 'C', x: 0, y: 0, z: 0 }, { element: 'O', x: 1.2, y: 0, z: 0 }];

function sphereChordError(mesh: MeshData, radius: number): number {
  let error = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = mesh.indices[index + edge] * 3, b = mesh.indices[index + (edge + 1) % 3] * 3;
      error = Math.max(error, 1 - Math.hypot(...[0, 1, 2].map(axis => (mesh.positions[a + axis] + mesh.positions[b + axis]) / 2)) / radius);
    }
  }
  return error;
}

function faceRadialError(mesh: MeshData, radius: number): number {
  let error = 0;
  for (let index = 0; index < mesh.indices.length; index += 3) {
    const center = [0, 1, 2].map(axis => (
      mesh.positions[mesh.indices[index] * 3 + axis]
      + mesh.positions[mesh.indices[index + 1] * 3 + axis]
      + mesh.positions[mesh.indices[index + 2] * 3 + axis]) / 3);
    error += Math.abs(Math.hypot(...center) - radius);
  }
  return error / (mesh.indices.length / 3);
}

describe('render quality geometry', () => {
  it('uses fast quality by default', () => {
    expect(DEFAULT_RENDER_QUALITY).toBe('fast');
    expect(buildMolecule(PAIR, OPTIONS)).toEqual(buildMolecule(PAIR, OPTIONS, 'fast'));
  });

  it('reduces sphere cost in fast and balanced modes without moving the analytic surface', () => {
    const atom = [PAIR[0]], options = { ...OPTIONS, style: 'spheres' } as const;
    const fast = buildMolecule(atom, options, 'fast');
    const balanced = buildMolecule(atom, options, 'balanced');
    const smooth = buildMolecule(atom, options, 'smooth');
    expect(fast).toEqual(balanced);
    expect(fast.positions.length / 3).toBe(642);
    expect(smooth.positions.length / 3).toBe(2562);
    expect(smooth.indices.length).toBe(fast.indices.length * 4);
    const radius = .4 * 1.43 * BOHR;
    for (const mesh of [fast, smooth]) {
      let radialError = 0;
      for (let vertex = 0; vertex < mesh.positions.length; vertex += 3) {
        radialError = Math.max(radialError, Math.abs(Math.hypot(...mesh.positions.slice(vertex, vertex + 3)) - radius));
      }
      expect(radialError).toBeLessThan(1e-7);
      expect(Array.from(mesh.colors.slice(0, 4))).toEqual([Math.fround(.6), Math.fround(.6), Math.fround(.6), 1]);
    }
    expect(sphereChordError(fast, radius)).toBeLessThan(.004);
    expect(sphereChordError(smooth, radius)).toBeLessThan(sphereChordError(fast, radius) * .26);
  });

  it.each(QUALITIES)('uses the %s bond detail while retaining the analytic bond radius and connection', quality => {
    const mesh = buildMolecule(PAIR, { ...OPTIONS, bondStyle: 'cylinder' }, quality);
    const detail = RENDER_QUALITY_SETTINGS[quality];
    const sphereVertices = detail.sphereSubdivisions === 4 ? 2562 : 642;
    const segments = detail.bondSegments, radius = .28 * BOHR;
    expect(mesh.positions.length / 3).toBe(2 * sphereVertices + 4 * segments);
    let chordError = 0;
    for (let ring = 0; ring < 4; ring += 1) {
      const base = 2 * sphereVertices + ring * segments;
      for (let index = 0; index < segments; index += 1) {
        const a = (base + index) * 3, b = (base + (index + 1) % segments) * 3;
        expect(Math.hypot(mesh.positions[a + 1], mesh.positions[a + 2])).toBeCloseTo(radius, 7);
        chordError = Math.max(chordError, 1 - Math.hypot((mesh.positions[a + 1] + mesh.positions[b + 1]) / 2,
          (mesh.positions[a + 2] + mesh.positions[b + 2]) / 2) / radius);
      }
    }
    expect(chordError).toBeLessThan({ fast: .02, balanced: .005, smooth: .0022 }[quality]);
    expect(mesh.positions[(2 * sphereVertices + segments) * 3]).toBeCloseTo(.6, 7);
    expect(mesh.positions[(2 * sphereVertices + 3 * segments) * 3]).toBeCloseTo(.6, 7);
    expect(mesh.indices.every(index => index < mesh.positions.length / 3)).toBe(true);
  });

  it('keeps the visible-atom sphere budget for every quality', () => {
    const atoms = Array.from({ length: 257 }, (_, index) => ({ element: index ? 'H' : 'C', x: index * 3, y: 0, z: 0 }));
    const options = { ...OPTIONS, style: 'spheres' } as const;
    for (const quality of QUALITIES) {
      expect(buildMolecule(atoms, options, quality).positions.length / 3).toBe(257 * 642);
    }
    expect(buildMolecule(atoms, { ...options, hydrogens: false }, 'smooth').positions.length / 3).toBe(2562);
  });

  it('trades orbital triangle count for smaller chord error without changing field data', () => {
    const values: number[] = [];
    for (let x = 0; x < 13; x++) for (let y = 0; y < 13; y++) for (let z = 0; z < 13; z++) {
      values.push(Math.exp(-((x - 6) ** 2 + (y - 6) ** 2 + (z - 6) ** 2) / 16));
    }
    const parsed = parseCube(['Gaussian fixture', 'Angstrom grid', '1 -1.5 -1.5 -1.5', '-13 .25 0 0',
      '-13 0 .25 0', '-13 0 0 .25', '6 6 0 0 0', values.join(' '),
    ].join('\n'));
    const source = parsed.cube, radius = Math.sqrt(-Math.log(.3));
    const meshes = QUALITIES.map(quality => buildOrbital(parsed, .3, RENDER_QUALITY_SETTINGS[quality].orbitalRefinement));
    expect(meshes[1].indices.length).toBeGreaterThan(meshes[0].indices.length);
    expect(meshes[2].indices.length).toBeGreaterThan(meshes[1].indices.length);
    expect(faceRadialError(meshes[1], radius)).toBeLessThan(faceRadialError(meshes[0], radius) * .5);
    expect(faceRadialError(meshes[2], radius)).toBeLessThan(faceRadialError(meshes[1], radius) * .7);
    expect(buildOrbital(parsed, .3)).toEqual(meshes[2]);
    expect(parsed.cube).toBe(source);
  });
});

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoLoader, DEMOS, demoManifestURL } from '../src/lib/demos';
import { formulaFor } from '../src/lib/importers';
import { buildOrbital } from '../src/render/geometry';
import type { DemoManifest, Orbital } from '../src/types';

interface StoredManifest extends DemoManifest {
  atomCount: number;
  grid: DemoManifest['grid'] & { dimensions: number[]; originBohr: number[] };
  orbitals: (Orbital & { compressedBytes?: number; uncompressedBytes?: number })[];
}

const assetPath = (path: string) => new URL(`../public/${path.replace(/^\.?\//, '')}`, import.meta.url);

afterEach(() => vi.unstubAllGlobals());

describe('bundled demo assets through the browser data and geometry pipeline', () => {
  it.each(DEMOS)('$name has matching metadata, structures, and renderable occupied orbitals', async ({ id, name }) => {
    const manifest: StoredManifest = JSON.parse(readFileSync(assetPath(demoManifestURL(id)), 'utf8'));
    expect(manifest.id).toBe(id);
    expect(manifest.name).toBe(name);
    expect(manifest.orbitals.some(orbital => orbital.id === manifest.defaultOrbitalId)).toBe(true);
    expect(new Set(manifest.orbitals.map(orbital => orbital.id)).size).toBe(manifest.orbitals.length);

    vi.stubGlobal('fetch', vi.fn(async (path: string) => new Response(readFileSync(assetPath(path)))));
    const load = createDemoLoader();
    const orbitals = id === 'benzene'
      ? manifest.orbitals.filter(orbital => orbital.id === manifest.defaultOrbitalId)
      : manifest.orbitals;

    for (const orbital of orbitals) {
      const { structure, volume, orbital: loadedOrbital } = await load(id, orbital.id);
      const label = `${id}/${orbital.id}`;
      expect(loadedOrbital.id, label).toBe(orbital.id);
      expect(loadedOrbital.occupation, label).toBeGreaterThan(0);
      expect(structure.atoms.length, label).toBe(manifest.atomCount);
      expect(volume.atoms.length, label).toBe(manifest.atomCount);
      expect(formulaFor(structure.atoms), label).toBe(manifest.formula.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻−+]+$/u, ''));
      expect(volume.dimensions, label).toEqual(manifest.grid.dimensions);
      for (let index = 0; index < structure.atoms.length; index += 1) {
        expect(volume.atoms[index].element, label).toBe(structure.atoms[index].element);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(volume.atoms[index][axis], label).toBeCloseTo(structure.atoms[index][axis], 6);
        }
      }
      const headers = volume.cube.split('\n', 6).map(line => line.trim().split(/\s+/).map(Number));
      for (let axis = 0; axis < 3; axis += 1) {
        expect(headers[2][axis + 1], label).toBeCloseTo(manifest.grid.originBohr[axis], 6);
        for (let component = 0; component < 3; component += 1) {
          expect(headers[axis + 3][component + 1], label)
            .toBeCloseTo(component === axis ? manifest.grid.spacingBohr : 0, 6);
        }
      }

      const bytes = readFileSync(assetPath(orbital.cubeUrl));
      const decoded = orbital.cubeUrl.endsWith('.gz') ? gunzipSync(bytes) : bytes;
      expect(decoded.byteLength, label).toBeLessThan(35 * 1024 * 1024);
      if (orbital.cubeUrl.endsWith('.gz')) {
        expect(bytes.byteLength, label).toBeLessThan(decoded.byteLength);
        expect(bytes.byteLength, label).toBe(orbital.compressedBytes);
        expect(decoded.byteLength, label).toBe(orbital.uncompressedBytes);
      }

      const mesh = buildOrbital(volume, orbital.isovalue);
      const vertices = mesh.positions.length / 3;
      expect(vertices, label).toBeGreaterThan(0);
      expect(mesh.positions.length % 3, label).toBe(0);
      expect(mesh.normals.length, label).toBe(mesh.positions.length);
      expect(mesh.colors.length, label).toBe(vertices * 4);
      expect(mesh.indices.length, label).toBeGreaterThan(0);
      expect(mesh.indices.length % 3, label).toBe(0);
      expect(mesh.positions.every(Number.isFinite), label).toBe(true);
      expect(mesh.normals.every(Number.isFinite), label).toBe(true);
      expect(mesh.colors.every(Number.isFinite), label).toBe(true);
      expect(mesh.indices.every(index => index < vertices), label).toBe(true);
      const positive = volume.range[1] > orbital.isovalue;
      const negative = volume.range[0] < -orbital.isovalue;
      expect(positive || negative, label).toBe(true);
      expect(mesh.positiveVertexCount > 0, label).toBe(positive);
      expect(vertices > mesh.positiveVertexCount, label).toBe(negative);
      expect(mesh.indices.some(index => index < mesh.positiveVertexCount), label).toBe(positive);
      expect(mesh.indices.some(index => index >= mesh.positiveVertexCount), label).toBe(negative);
    }
  }, 30_000);
});

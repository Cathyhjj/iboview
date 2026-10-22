import type { DemoManifest, Orbital } from '../types';
import { parseCube, parseXYZ, type ParsedCube } from './importers';

export const DEMOS = [
  { id: 'benzene', name: 'Benzene', detail: 'Aromatic ring · 12 atoms' },
  { id: 'feco3no', name: 'Iron carbonyl nitrosyl', detail: 'Metal complex · 9 atoms' },
  { id: 're2me8', name: 'Rhenium methyl dimer', detail: 'Two metal centers · 34 atoms' },
  { id: 'sn2-intermediate', name: 'Iron-assisted SN2 intermediate', detail: 'Reaction intermediate · 32 atoms' },
] as const;

export const assetURL = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
export const demoManifestURL = (id: string) => `data/${id}/manifest.json`;

export function orbitalKind(orbital: Orbital) {
  if (orbital.type === 'pi') return 'π bonding';
  if (orbital.type === 'sigma') return 'σ bonding';
  return 'Localized IBO';
}

async function fetchText(path: string) {
  const response = await fetch(assetURL(path));
  if (!response.ok) throw new Error(`Could not load ${path.split('/').pop()} (${response.status}).`);
  if (!path.endsWith('.gz')) return response.text();
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Some static hosts decompress gzip assets before returning their bodies.
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This example needs a browser with gzip decompression support. Please update your browser.');
  }
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

export function createDemoLoader() {
  const manifests = new Map<string, DemoManifest>();
  const structures = new Map<string, ReturnType<typeof parseXYZ>>();
  const cubes = new Map<string, ParsedCube>();
  return async (id: string, orbitalId?: string) => {
    const manifest: DemoManifest = manifests.get(id) ?? JSON.parse(await fetchText(demoManifestURL(id)));
    const orbital = manifest.orbitals.find(item => item.id === (orbitalId ?? manifest.defaultOrbitalId));
    if (!orbital) throw new Error('This example does not contain the requested orbital.');
    const [structure, volume] = await Promise.all([
      structures.get(id) ?? fetchText(manifest.xyzUrl).then(parseXYZ),
      cubes.get(orbital.cubeUrl) ?? fetchText(orbital.cubeUrl).then(parseCube),
    ]);
    manifests.set(id, manifest);
    structures.set(id, structure);
    // Bound retained grid text while keeping recently viewed orbitals available.
    cubes.delete(orbital.cubeUrl);
    cubes.set(orbital.cubeUrl, volume);
    if (cubes.size > 4) cubes.delete(cubes.keys().next().value!);
    return { manifest, orbital, structure, volume };
  };
}

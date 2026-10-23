import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { parseCrystal } from '../src/lib/crystal';
import type { DemoManifest, DisplaySettings, Orbital } from '../src/types';
import { parseCube, parseXYZ, type ParsedStructure } from '../src/lib/importers';
import { DEFAULT_MOLECULE_APPEARANCE } from '../src/lib/molecule-appearance';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors } from '../src/lib/orbital-colors';
import { DEMOS } from '../src/lib/demos';
import { MAX_PROJECT_BYTES, PROJECT_EXTENSION, parseProject, projectFileName, serializeProject, type ProjectSnapshot } from '../src/lib/project';

const cube = parseCube([
  'Original scalar field', 'Signs, amplitudes and comments are retained', '1 0 0 0',
  '2 1 0.1 0', '2 0 1 0', '2 0 0 1', '6 6 0 0 0',
  '-0.25 -0.1 0 0.1 0.2 0.3 0.4 0.5',
].join('\n'));
const secondCube = parseCube(cube.cube.replace('-0.25 -0.1', '0.75 -0.15'));
const colors = {
  ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' as const, reversed: true,
  vmin: 0.14, vmax: 0.82, gradientExtent: 0.73, gradientStrength: 1.7,
};
const settings: DisplaySettings = {
  ...DEFAULT_MOLECULE_APPEARANCE, style: 'wireframe', hydrogens: false, labels: true,
  atomScale: 1.4, hydrogenScale: 0.7, bondScale: 0.35, bonds: false,
  atomPalette: 'uniform', atomColor: '#abcdef', elementColors: { C: '#123456' },
  bondStyle: 'cylinder', bondColorMode: 'uniform', bondColor: '#fedcba', atomMaterial: 'shiny',
  isovalue: 0.026, opacity: 0.76, surface: false, spinning: true, material: 'soft',
  ...orbitalPhaseColors(colors),
};
const camera = {
  rotation: [0, 0.6, 0, 0.8] as [number, number, number, number],
  center: [1.25, -2.1, 3] as [number, number, number], pan: [-0.2, 1.3] as [number, number],
  halfHeight: 4.75, fittedHalfHeight: 7.25, cameraDistance: 80,
};
const orbital: Orbital = {
  id: 'ibo-1', label: 'IBO 1', description: 'Original source orbital', type: 'sigma',
  occupation: 2, energyHartree: -0.423, cubeUrl: '/data/example/ibo-1.cube', isovalue: 0.045,
};
const manifest: DemoManifest = {
  id: 'example', name: 'Example molecule', description: 'Portable molecular data', formula: 'C',
  xyzUrl: '/data/example/example.xyz', defaultOrbitalId: 'ibo-1',
  source: { file: 'example-data/original.xml', description: 'Scientific provenance' },
  method: 'PBE / TZVPP · IBO', isovalueMin: 0.015, grid: { spacingBohr: 0.2 },
  orbitals: [orbital, { ...orbital, id: 'ibo-2', label: 'IBO 2', cubeUrl: '/data/example/ibo-2.cube' }],
};

function snapshot(kind: 'xyz' | 'cube' | 'demo' = 'demo'): ProjectSnapshot {
  return {
    scene: {
      key: `${kind}-scene`, name: 'Carbon example', formula: 'C', fileName: kind === 'demo' ? 'original.xml' : `carbon.${kind}`,
      kind, structure: parseXYZ(cube.xyz),
      ...(kind === 'xyz' ? {} : { volume: cube }), ...(kind === 'demo' ? { orbital } : {}),
    },
    ...(kind === 'demo' ? { manifest, volumes: { 'ibo-1': cube, 'ibo-2': secondCube } } : {}),
    settings, colors, camera, theme: 'dark',
  };
}

function stored() { return JSON.parse(serializeProject(snapshot())); }

describe('portable IboView projects', () => {
  it('preserves the periodic lattice and rejects mismatched crystal coordinates', () => {
    const original = snapshot('xyz');
    const crystal = parseCrystal('Iron\n1\n3 0 0\n0 3 0\n0 0 3\nFe\n1\nDirect\n0 0 0\n', 'poscar');
    original.scene = { ...original.scene, kind: 'crystal', crystal, structure: parseXYZ('1\nIron\nFe 0 0 0\n') };
    expect(parseProject(serializeProject(original)).scene.crystal).toEqual(crystal);
    const invalid = JSON.parse(serializeProject(original));
    invalid.scene.xyz = '1\nIron\nFe 1 0 0\n';
    expect(() => parseProject(JSON.stringify(invalid))).toThrow(/do not match/);
  });
  it.each(['xyz', 'cube', 'demo'] as const)('round trips %s data, appearance, camera and theme without network access', kind => {
    const fetch = vi.fn(() => { throw new Error('No network allowed'); });
    vi.stubGlobal('fetch', fetch);
    try {
      const original = snapshot(kind);
      const text = serializeProject(original);
      const restored = parseProject(text);
      expect(restored).toEqual(original);
      expect(serializeProject(restored)).toBe(text);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('stores the selected example field only once while embedding every orbital', () => {
    const document = stored();
    expect(document.format).toBe('iboview-project');
    expect(document.version).toBe(1);
    expect(document.scene.volumeId).toBe('ibo-1');
    expect(document.scene.volume).toBeUndefined();
    expect(document.volumes).toEqual({ 'ibo-1': cube.cube, 'ibo-2': secondCube.cube });
    const restored = parseProject(JSON.stringify(document));
    expect(restored.scene.volume).toBe(restored.volumes!['ibo-1']);
    expect(restored.scene.volume!.range).toEqual([-0.25, 0.5]);
    expect(restored.volumes!['ibo-2'].range).toEqual([-0.15, 0.75]);
    expect(restored.scene.volume!.cube).toBe(cube.cube);
  });

  it.each(DEMOS)('preserves the full bundled $name manifest and every real orbital field', ({ id }) => {
    const asset = (path: string) => new URL(`../public/${path.replace(/^\//, '')}`, import.meta.url);
    const readAsset = (path: string) => {
      const bytes = readFileSync(asset(path));
      return (path.endsWith('.gz') ? gunzipSync(bytes) : bytes).toString('utf8');
    };
    const realManifest: DemoManifest = JSON.parse(readAsset(`data/${id}/manifest.json`));
    const volumes = Object.fromEntries(realManifest.orbitals.map(item => [item.id, parseCube(readAsset(item.cubeUrl))]));
    const selected = realManifest.orbitals[1];
    const original: ProjectSnapshot = {
      ...snapshot(), manifest: realManifest, volumes,
      scene: { key: `${id}-demo`, name: realManifest.name, formula: realManifest.formula, fileName: realManifest.source.file,
        kind: 'demo', structure: parseXYZ(readAsset(realManifest.xyzUrl)), orbital: selected, volume: volumes[selected.id] },
    };
    const restored = parseProject(serializeProject(original));
    // Canonical XYZ/Cube coordinates stringify both -0 and +0 as "0".
    const canonicalZeros = <T extends ParsedStructure>(structure: T): T => ({
      ...structure, atoms: structure.atoms.map(atom => ({ ...atom, x: atom.x + 0, y: atom.y + 0, z: atom.z + 0 })),
    });
    expect(restored).toEqual({
      ...original, scene: { ...original.scene, structure: canonicalZeros(original.scene.structure), volume: canonicalZeros(original.scene.volume!) },
      volumes: Object.fromEntries(Object.entries(volumes).map(([key, volume]) => [key, canonicalZeros(volume)])),
    });
    expect(restored.manifest).toHaveProperty('source.sha256');
    expect(restored.manifest).toHaveProperty('grid.normalization');
    if (id === 'benzene') expect(restored.manifest).toHaveProperty('validation.fineGridOrbitalNorms');
  }, 30_000);

  it('accepts a BOM and retains source URLs as metadata', () => {
    const document = stored();
    document.manifest.xyzUrl = 'https://example.org/original.xyz';
    document.manifest.orbitals[0].cubeUrl = 'https://example.org/original.cube';
    expect(parseProject(`\uFEFF${JSON.stringify(document)}`).manifest!.orbitals[0].cubeUrl).toBe('https://example.org/original.cube');
  });

  it('normalizes bounded appearance and color preferences using the existing preference rules', () => {
    const document = stored();
    document.settings.atomScale = 500;
    document.settings.elementColors = { C: '#123456', invalid: 'red' };
    document.colors.gradientStrength = 7;
    document.colors.palette = 'unknown';
    const restored = parseProject(JSON.stringify(document));
    expect(restored.settings.atomScale).toBe(2);
    expect(restored.settings.elementColors).toEqual({ C: '#123456' });
    expect(restored.colors.gradientStrength).toBe(2);
    expect(restored.colors.palette).toBe('iboview');
  });

  it.each(['scene', 'volumes', 'settings', 'colors', 'camera', 'theme'])('rejects a missing required %s field', field => {
    const document = stored();
    delete document[field];
    expect(() => parseProject(JSON.stringify(document))).toThrow(/Project/);
  });

  it.each([
    ['foreign format', (document: any) => { document.format = 'other'; }, /not an IboView/],
    ['newer version', (document: any) => { document.version = 2; }, /Unsupported.*version/],
    ['missing version', (document: any) => { delete document.version; }, /Unsupported.*version/],
    ['missing selected field', (document: any) => { delete document.volumes['ibo-1']; }, /selected volume/],
    ['missing unselected field', (document: any) => { delete document.volumes['ibo-2']; }, /every example orbital/],
    ['truncated Cube', (document: any) => { document.volumes['ibo-2'] = cube.cube.slice(0, -4); }, /field size mismatch/],
    ['invalid structure', (document: any) => { document.scene.xyz = '1\n\nC NaN 0 0'; }, /finite number/],
    ['mismatched geometry', (document: any) => { document.scene.xyz = '1\n\nH 0 0 0'; }, /geometries/],
    ['missing example metadata', (document: any) => { delete document.manifest; }, /example metadata/],
    ['duplicate orbital ID', (document: any) => { document.manifest.orbitals[1].id = 'ibo-1'; }, /duplicate/],
    ['invalid default orbital', (document: any) => { document.manifest.defaultOrbitalId = 'absent'; }, /default orbital/],
    ['invalid selection', (document: any) => { document.scene.orbital.id = 'absent'; }, /selected orbital/],
    ['script URL', (document: any) => { document.manifest.xyzUrl = 'javascript:alert(1)'; }, /HTTP URL/],
    ['unsafe example ID', (document: any) => { document.manifest.id = '../other'; }, /example ID/],
    ['zero quaternion', (document: any) => { document.camera.rotation = [0, 0, 0, 0]; }, /camera/],
    ['invalid zoom', (document: any) => { document.camera.halfHeight = 1e10; }, /camera/],
    ['string isovalue', (document: any) => { document.settings.isovalue = '0.02'; }, /isovalue/],
    ['zero isovalue', (document: any) => { document.settings.isovalue = 0; }, /isovalue/],
    ['invalid opacity', (document: any) => { document.settings.opacity = 2; }, /opacity/],
    ['invalid boolean', (document: any) => { document.settings.surface = 'true'; }, /booleans/],
    ['invalid material', (document: any) => { document.settings.material = 'invalid'; }, /material/],
    ['invalid gradient', (document: any) => { document.settings.orbitalGradient.positive = ['red', '#123456']; }, /hexadecimal color/],
  ])('rejects %s before restoring a workspace', (_label, change, error) => {
    const document = stored();
    change(document);
    expect(() => parseProject(JSON.stringify(document))).toThrow(error);
  });

  it('rejects malformed JSON and nonfinite JSON numbers', () => {
    expect(() => parseProject('{broken')).toThrow(/valid JSON/);
    const text = serializeProject(snapshot()).replace('"isovalue": 0.026', '"isovalue": 1e999');
    expect(() => parseProject(text)).toThrow(/isovalue.*finite/);
  });

  it('checks the size limit before attempting JSON parsing', () => {
    expect(MAX_PROJECT_BYTES).toBe(200 * 1024 * 1024);
    expect(() => parseProject(' '.repeat(MAX_PROJECT_BYTES + 1))).toThrow(/200 MB/);
  });

  it('refuses to save an incomplete or inconsistent example', () => {
    expect(() => serializeProject({ ...snapshot(), volumes: { 'ibo-1': cube } })).toThrow(/every example orbital/);
    expect(() => serializeProject({ ...snapshot(), volumes: { 'ibo-1': secondCube, 'ibo-2': secondCube } })).toThrow(/does not match/);
    expect(() => serializeProject({ ...snapshot(), camera: { ...camera, halfHeight: NaN } })).toThrow(/camera/);
  });

  it.each([
    ['benzene.xyz', 'benzene.iboview.json'], ['FIELD.CUBE', 'FIELD.iboview.json'],
    ['My view.iboview.json', 'My view.iboview.json'], [' . ', 'IboView project.iboview.json'],
    ['a/b:c?d', 'a-b-c-d.iboview.json'], ['分子 view', '分子 view.iboview.json'],
  ])('uses a portable project filename for %s', (name, expected) => {
    expect(PROJECT_EXTENSION).toBe('.iboview.json');
    expect(projectFileName(name)).toBe(expected);
  });
});

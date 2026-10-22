import { nativeElementHex } from './element-colors';

export interface MoleculeAppearance {
  style: 'ball-stick' | 'stick' | 'space-fill' | 'wireframe' | 'spheres';
  hydrogens: boolean;
  labels: boolean;
  atomScale: number;
  hydrogenScale: number;
  bondScale: number;
  bonds: boolean;
  bondStyle: 'tapered' | 'cylinder';
  atomPalette: 'native' | 'studio' | 'pastel' | 'vivid' | 'uniform';
  atomColor: string;
  elementColors: Record<string, string>;
  bondColorMode: 'element' | 'uniform';
  bondColor: string;
  atomMaterial: 'shiny' | 'soft' | 'extra';
}

export const DEFAULT_MOLECULE_APPEARANCE: MoleculeAppearance = {
  style: 'ball-stick', hydrogens: true, labels: false,
  atomScale: 1, hydrogenScale: 1, bondScale: 1, bonds: true,
  bondStyle: 'tapered', atomPalette: 'native', atomColor: '#9b8ac4',
  elementColors: {}, bondColorMode: 'element', bondColor: '#9399a8', atomMaterial: 'extra',
};

export const REPRESENTATIONS: { id: MoleculeAppearance['style']; name: string; description: string }[] = [
  { id: 'ball-stick', name: 'Ball & stick', description: 'Atoms and sculpted bonds' },
  { id: 'stick', name: 'Sticks', description: 'Smooth, connected cylinders' },
  { id: 'wireframe', name: 'Wireframe', description: 'A delicate molecular skeleton' },
  { id: 'space-fill', name: 'Space filling', description: 'Scaled van der Waals spheres' },
  { id: 'spheres', name: 'Spheres', description: 'Separate atoms, without bonds' },
];

const PALETTE_COLORS: Record<'studio' | 'pastel' | 'vivid', Record<string, number>> = {
  studio: { H: 0xe6e8ef, C: 0x53617a, N: 0x657de5, O: 0xe46978, F: 0x52bca2, P: 0xe5a755, S: 0xe7c65b, Cl: 0x63ba8c, Br: 0xb57e69, I: 0x9d7dce, Fe: 0xdca45c, Re: 0x69aeb3, Cu: 0xcd9272, Ni: 0x78b59c, Co: 0x889bd1, Zn: 0x8d9db2 },
  pastel: { H: 0xf1eaf3, C: 0xb4a3cf, N: 0x95b3df, O: 0xeaa2b2, F: 0xa4d6c5, P: 0xebbc91, S: 0xe8d994, Cl: 0xa7cfb0, Br: 0xd3a59b, I: 0xc3a1de, Fe: 0xe2bd98, Re: 0x9dcbd0, Cu: 0xe0b1a1, Ni: 0xa8d0bf, Co: 0xa5b6db, Zn: 0xb8c4d5 },
  vivid: { H: 0xe8edf5, C: 0x36435b, N: 0x4374f0, O: 0xf15c72, F: 0x35c9a0, P: 0xffa64a, S: 0xf2ce44, Cl: 0x4fc285, Br: 0xb86a51, I: 0x9a61d6, Fe: 0xf0a845, Re: 0x26aeb7, Cu: 0xd6864e, Ni: 0x51b99b, Co: 0x667ee5, Zn: 0x8dabc8 },
};

export const ATOM_PALETTES: { id: MoleculeAppearance['atomPalette']; name: string; swatches: readonly string[] }[] = [
  { id: 'native', name: 'IboView', swatches: ['#999999', '#87cee6', '#ff0000', '#ffaa00'] },
  { id: 'studio', name: 'Studio', swatches: ['#53617a', '#657de5', '#e46978', '#dca45c'] },
  { id: 'pastel', name: 'Pastel', swatches: ['#b4a3cf', '#95b3df', '#eaa2b2', '#e2bd98'] },
  { id: 'vivid', name: 'Vivid', swatches: ['#36435b', '#4374f0', '#f15c72', '#f0a845'] },
  { id: 'uniform', name: 'Single color', swatches: ['#9b8ac4'] },
];

export const MOLECULE_PRESETS: { id: string; name: string; description: string; swatches: readonly string[]; settings: MoleculeAppearance }[] = [
  { id: 'original', name: 'Original', description: 'Classic IboView', swatches: ['#999999', '#87cee6', '#ff0000'], settings: { ...DEFAULT_MOLECULE_APPEARANCE } },
  { id: 'studio', name: 'Studio', description: 'Crisp & balanced', swatches: ['#53617a', '#657de5', '#e46978'], settings: { ...DEFAULT_MOLECULE_APPEARANCE, atomPalette: 'studio', atomMaterial: 'shiny', atomScale: 1.15, bondScale: 0.85, bondStyle: 'cylinder', hydrogenScale: 0.85 } },
  { id: 'porcelain', name: 'Porcelain', description: 'Soft pastel spheres', swatches: ['#b4a3cf', '#95b3df', '#eaa2b2'], settings: { ...DEFAULT_MOLECULE_APPEARANCE, atomPalette: 'pastel', atomMaterial: 'soft', atomScale: 1.4, bondScale: 0.7, hydrogenScale: 0.8, bondStyle: 'cylinder' } },
  { id: 'skeleton', name: 'Skeleton', description: 'Fine, airy lines', swatches: ['#53617a', '#657de5', '#e46978'], settings: { ...DEFAULT_MOLECULE_APPEARANCE, style: 'wireframe', atomPalette: 'studio', atomMaterial: 'soft', bondStyle: 'cylinder' } },
  { id: 'jewel', name: 'Jewel', description: 'Vivid & sculptural', swatches: ['#36435b', '#4374f0', '#f15c72'], settings: { ...DEFAULT_MOLECULE_APPEARANCE, style: 'space-fill', atomPalette: 'vivid', atomScale: 0.8, atomMaterial: 'shiny' } },
  { id: 'silver', name: 'Silver', description: 'Quiet monochrome', swatches: ['#9aa6b8', '#b5c0cf', '#75869c'], settings: { ...DEFAULT_MOLECULE_APPEARANCE, atomPalette: 'uniform', atomMaterial: 'shiny', atomColor: '#9aa6b8', bondColorMode: 'uniform', bondColor: '#75869c', atomScale: 1.2, bondScale: 0.75, bondStyle: 'cylinder' } },
];

const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export function moleculeAtomColor(element: string, nativeHex: number, options: Partial<MoleculeAppearance>): number {
  const custom = options.elementColors?.[element];
  if (isHexColor(custom)) return Number.parseInt(custom.slice(1), 16);
  if (options.atomPalette === 'uniform') return Number.parseInt((isHexColor(options.atomColor) ? options.atomColor : DEFAULT_MOLECULE_APPEARANCE.atomColor).slice(1), 16);
  if (!options.atomPalette || options.atomPalette === 'native') return nativeHex;
  const palette = PALETTE_COLORS[options.atomPalette];
  return palette?.[element] ?? nativeHex;
}

export function elementDisplayColor(element: string, options: MoleculeAppearance): string {
  return `#${moleculeAtomColor(element, nativeElementHex(element), options).toString(16).padStart(6, '0')}`;
}

export const MOLECULE_STORAGE_KEY = 'iboview-molecule-appearance-v1';

/** Read only the known appearance fields, keeping imported or old preferences bounded. */
export function normalizeMoleculeAppearance(value: unknown): MoleculeAppearance {
  const result = { ...DEFAULT_MOLECULE_APPEARANCE, elementColors: {} as Record<string, string> };
  if (!value || typeof value !== 'object') return result;
  const input = value as Record<string, unknown>;
  for (const key of ['hydrogens', 'labels', 'bonds'] as const) if (typeof input[key] === 'boolean') result[key] = input[key];
  for (const [key, min, max] of [['atomScale', 0.4, 2], ['hydrogenScale', 0.4, 1.5], ['bondScale', 0.25, 2]] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(min, Math.min(max, input[key]));
  }
  const choices = {
    style: REPRESENTATIONS.map(item => item.id), atomPalette: ATOM_PALETTES.map(item => item.id),
    bondStyle: ['tapered', 'cylinder'], bondColorMode: ['element', 'uniform'], atomMaterial: ['shiny', 'soft', 'extra'],
  };
  for (const key of Object.keys(choices) as (keyof typeof choices)[]) {
    if ((choices[key] as readonly unknown[]).includes(input[key])) Object.assign(result, { [key]: input[key] });
  }
  for (const key of ['atomColor', 'bondColor'] as const) if (isHexColor(input[key])) result[key] = input[key];
  if (input.elementColors && typeof input.elementColors === 'object') {
    for (const [element, hex] of Object.entries(input.elementColors)) {
      if (/^[A-Z][a-z]?$/.test(element) && isHexColor(hex)) result.elementColors[element] = hex;
    }
  }
  return result;
}

export function readMoleculeAppearance(): MoleculeAppearance {
  try { return normalizeMoleculeAppearance(JSON.parse(localStorage.getItem(MOLECULE_STORAGE_KEY) ?? 'null')); }
  catch { return normalizeMoleculeAppearance(null); }
}

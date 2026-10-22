import type { DisplaySettings } from '../types';
import { ATOM_PALETTES, REPRESENTATIONS, normalizeMoleculeAppearance, type MoleculeAppearance } from './molecule-appearance';
import { loadOrbitalColors } from './orbital-color-storage';
import { orbitalPhaseColors, type OrbitalColors } from './orbital-colors';
import { isPlotPalette } from './palettes/athena-plot-colors';

export const CONFIG_EXTENSION = '.iboview-config.json';
export const MAX_CONFIG_BYTES = 64 * 1024;
const CONFIG_FORMAT = 'iboview-appearance-config';
const CONFIG_VERSION = 1;

export interface AppearanceConfig {
  appearance: MoleculeAppearance;
  colors: OrbitalColors;
  opacity: number;
  material: DisplaySettings['material'];
  theme: 'light' | 'dark';
}

type RecordValue = Record<string, unknown>;

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Config ${label} is missing or invalid.`);
  return value as RecordValue;
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error(`Config ${label} is missing or invalid.`);
  return value as T;
}

function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Config ${label} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Config ${label} must be a boolean.`);
  return value;
}

function hexColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Config ${label} must be a hexadecimal color.`);
  return value;
}

const MATERIALS = ['shiny', 'soft', 'extra'] as const;

function moleculeAppearance(value: unknown): MoleculeAppearance {
  const input = object(value, 'molecule appearance');
  choice(input.style, REPRESENTATIONS.map(item => item.id), 'representation');
  choice(input.atomPalette, ATOM_PALETTES.map(item => item.id), 'atom palette');
  choice(input.bondStyle, ['tapered', 'cylinder'], 'bond style');
  choice(input.bondColorMode, ['element', 'uniform'], 'bond color mode');
  choice(input.atomMaterial, MATERIALS, 'atom material');
  for (const key of ['hydrogens', 'labels', 'bonds']) boolean(input[key], key);
  number(input.atomScale, 'atom scale', 0.4, 2);
  number(input.hydrogenScale, 'hydrogen scale', 0.4, 1.5);
  number(input.bondScale, 'bond scale', 0.25, 2);
  hexColor(input.atomColor, 'atom color');
  hexColor(input.bondColor, 'bond color');
  const elements = object(input.elementColors, 'element colors');
  for (const [element, color] of Object.entries(elements)) {
    if (!/^[A-Z][a-z]?$/.test(element)) throw new Error('Config element color symbol is invalid.');
    hexColor(color, `${element} color`);
  }
  return normalizeMoleculeAppearance(input);
}

function orbitalColors(value: unknown): OrbitalColors {
  const input = object(value, 'orbital colors');
  if (input.palette !== 'iboview' && input.palette !== 'custom' && !isPlotPalette(input.palette)) {
    throw new Error('Config orbital palette is missing or invalid.');
  }
  boolean(input.reversed, 'reversed palette');
  number(input.vmin, 'palette minimum', 0, 1);
  number(input.vmax, 'palette maximum', 0, 1);
  if ((input.vmin as number) > (input.vmax as number)) throw new Error('Config palette minimum must not exceed its maximum.');
  number(input.gradientExtent, 'gradient extent', 0, 1);
  number(input.gradientStrength, 'gradient strength', 0, 2);
  hexColor(input.positiveColor, 'positive phase color');
  hexColor(input.negativeColor, 'negative phase color');
  return loadOrbitalColors({ getItem: () => JSON.stringify(input) });
}

function readConfig(value: unknown): AppearanceConfig {
  const input = object(value, 'settings');
  return {
    appearance: moleculeAppearance(input.appearance),
    colors: orbitalColors(input.colors),
    opacity: number(input.opacity, 'opacity', 0, 1),
    material: choice(input.material, MATERIALS, 'orbital material'),
    theme: choice(input.theme, ['light', 'dark'], 'theme'),
  };
}

function checkSize(text: string): void {
  if (text.length > MAX_CONFIG_BYTES || new TextEncoder().encode(text).byteLength > MAX_CONFIG_BYTES) {
    throw new Error('Config files must be 64 KB or smaller.');
  }
}

export function parseAppearanceConfig(text: string): AppearanceConfig {
  checkSize(text);
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('The config file is not valid JSON.'); }
  const document = object(value, 'document');
  if (document.format !== CONFIG_FORMAT) throw new Error('This is not an IboView appearance config file.');
  if (document.version !== CONFIG_VERSION) throw new Error(`Unsupported IboView config version: ${String(document.version)}.`);
  return readConfig(document);
}

export function serializeAppearanceConfig({ settings, colors, theme }: {
  settings: DisplaySettings; colors: OrbitalColors; theme: AppearanceConfig['theme'];
}): string {
  const config = readConfig({ appearance: settings, colors, theme, opacity: settings.opacity, material: settings.material });
  const text = JSON.stringify({ format: CONFIG_FORMAT, version: CONFIG_VERSION, ...config }, null, 2);
  checkSize(text);
  return text;
}

/** Apply reusable appearance while retaining the destination project's scientific and view state. */
export function applyAppearanceConfig(settings: DisplaySettings, config: AppearanceConfig): DisplaySettings {
  const normalized = readConfig(config);
  const phases = orbitalPhaseColors(normalized.colors);
  const result: DisplaySettings = {
    ...settings, ...normalized.appearance,
    opacity: normalized.opacity, material: normalized.material, ...phases,
  };
  if (!phases.orbitalGradient) delete result.orbitalGradient;
  return result;
}

export function configFileName(name: string): string {
  const base = name.replace(/(?:\.iboview-config\.json|\.iboview\.json|\.xyz|\.cub|\.cube|\.json)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120).trim();
  return `${base || 'IboView appearance'}${CONFIG_EXTENSION}`;
}

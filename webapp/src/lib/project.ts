import type { DemoManifest, DisplaySettings, Orbital, Scene } from '../types';
import { normalizeCameraState, type CameraState } from './camera-state';
import { parseCube, parseXYZ, type ParsedCube, type ParsedStructure } from './importers';
import { normalizeMoleculeAppearance } from './molecule-appearance';
import { loadOrbitalColors } from './orbital-color-storage';
import type { OrbitalColors } from './orbital-colors';
import { parseCrystal } from './crystal';
import { parseXYZTrajectory } from './trajectory';
import { normalizeNamedViews, type NamedView } from './research-views';

export const PROJECT_EXTENSION = '.iboview.json';
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
const PROJECT_FORMAT = 'iboview-project';
const PROJECT_VERSION = 1;

export interface ProjectSnapshot {
  scene: Scene;
  manifest?: DemoManifest;
  /** Embedded demo fields keyed by orbital ID. */
  volumes?: Record<string, ParsedCube>;
  settings: DisplaySettings;
  colors: OrbitalColors;
  camera: CameraState;
  theme: 'light' | 'dark';
  namedViews?: NamedView[];
}

type RecordValue = Record<string, unknown>;

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Project ${label} is missing or invalid.`);
  return value as RecordValue;
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) throw new Error(`Project ${label} must be text.`);
  return value;
}

function number(value: unknown, label: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Project ${label} must be a finite number between ${min} and ${max}.`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  const id = string(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) {
    throw new Error(`Project ${label} is invalid.`);
  }
  return id;
}

function metadataURL(value: unknown, label: string): string {
  const path = string(value, label);
  let url: URL;
  try { url = new URL(path, 'https://iboview.invalid/'); }
  catch { throw new Error(`Project ${label} is invalid.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Project ${label} must be an HTTP URL or an asset path.`);
  return path;
}

function orbitalMetadata(value: unknown): Orbital {
  const orbital = object(value, 'orbital');
  return {
    ...orbital,
    id: identifier(orbital.id, 'orbital ID'),
    label: string(orbital.label, 'orbital label'),
    description: string(orbital.description, 'orbital description', true),
    ...(orbital.type === undefined ? {} : { type: string(orbital.type, 'orbital type') }),
    occupation: number(orbital.occupation, 'orbital occupation', 0),
    ...(orbital.energyHartree === undefined ? {} : { energyHartree: number(orbital.energyHartree, 'orbital energy') }),
    cubeUrl: metadataURL(orbital.cubeUrl, 'orbital source URL'),
    isovalue: number(orbital.isovalue, 'orbital isovalue', Number.MIN_VALUE),
  };
}

function manifestMetadata(value: unknown): DemoManifest {
  const manifest = object(value, 'example metadata');
  const source = object(manifest.source, 'example source');
  const grid = object(manifest.grid, 'example grid');
  if (!Array.isArray(manifest.orbitals) || !manifest.orbitals.length) throw new Error('Project example must contain orbitals.');
  const orbitals = manifest.orbitals.map(orbitalMetadata);
  const ids = new Set(orbitals.map(orbital => orbital.id));
  if (ids.size !== orbitals.length) throw new Error('Project contains duplicate orbital IDs.');
  const defaultOrbitalId = identifier(manifest.defaultOrbitalId, 'default orbital ID');
  if (!ids.has(defaultOrbitalId)) throw new Error('Project default orbital is missing.');
  return {
    ...manifest,
    id: identifier(manifest.id, 'example ID'),
    name: string(manifest.name, 'example name'),
    formula: string(manifest.formula, 'example formula'),
    ...(manifest.description === undefined ? {} : { description: string(manifest.description, 'example description', true) }),
    xyzUrl: metadataURL(manifest.xyzUrl, 'structure source URL'), defaultOrbitalId,
    source: { ...source, file: string(source.file, 'source file'), description: string(source.description, 'source description', true) },
    method: string(manifest.method, 'example method'),
    ...(manifest.isovalueMin === undefined ? {} : { isovalueMin: number(manifest.isovalueMin, 'minimum isovalue', Number.MIN_VALUE) }),
    grid: { ...grid, spacingBohr: number(grid.spacingBohr, 'grid spacing', Number.MIN_VALUE) }, orbitals,
  };
}

function hexColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Project ${label} must be a hexadecimal color.`);
  return value;
}

function displaySettings(value: unknown): DisplaySettings {
  const settings = object(value, 'display settings');
  if (typeof settings.surface !== 'boolean' || typeof settings.spinning !== 'boolean') {
    throw new Error('Project surface and spinning settings must be booleans.');
  }
  if (settings.material !== 'shiny' && settings.material !== 'soft' && settings.material !== 'extra') {
    throw new Error('Project orbital material is invalid.');
  }
  let orbitalGradient: DisplaySettings['orbitalGradient'];
  if (settings.orbitalGradient !== undefined) {
    const gradient = object(settings.orbitalGradient, 'orbital gradient');
    const ramp = (value: unknown) => {
      if (!Array.isArray(value) || value.length < 2 || value.length > 256) throw new Error('Project orbital gradient must contain 2–256 colors per phase.');
      return value.map(color => hexColor(color, 'gradient color'));
    };
    orbitalGradient = {
      positive: ramp(gradient.positive), negative: ramp(gradient.negative),
      ...(gradient.extent === undefined ? {} : { extent: number(gradient.extent, 'gradient extent', 0, 1) }),
    };
  }
  return {
    ...normalizeMoleculeAppearance(settings),
    isovalue: number(settings.isovalue, 'isovalue', Number.MIN_VALUE),
    opacity: number(settings.opacity, 'opacity', 0, 1), surface: settings.surface, spinning: settings.spinning,
    material: settings.material,
    positiveColor: hexColor(settings.positiveColor, 'positive phase color'),
    negativeColor: hexColor(settings.negativeColor, 'negative phase color'),
    ...(orbitalGradient ? { orbitalGradient } : {}),
  };
}

function matchingGeometry(structure: ParsedStructure, volume: ParsedCube): void {
  if (structure.atoms.length !== volume.atoms.length || structure.atoms.some((atom, i) => {
    const other = volume.atoms[i];
    return atom.element !== other.element || ['x', 'y', 'z'].some(axis =>
      Math.abs(atom[axis as 'x' | 'y' | 'z'] - other[axis as 'x' | 'y' | 'z']) > 1e-5);
  })) throw new Error('Project structure and embedded orbital geometries do not match.');
}

function readDocument(value: unknown): ProjectSnapshot {
  const document = object(value, 'document');
  if (document.format !== PROJECT_FORMAT) throw new Error('This is not an IboView project file.');
  if (document.version !== PROJECT_VERSION) throw new Error(`Unsupported IboView project version: ${String(document.version)}.`);
  const storedScene = object(document.scene, 'scene');
  const kind = storedScene.kind;
  if (kind !== 'demo' && kind !== 'xyz' && kind !== 'cube' && kind !== 'crystal') throw new Error('Project scene kind is invalid.');
  const structure = parseXYZ(string(storedScene.xyz, 'structure data'));
  const trajectory = storedScene.trajectory === undefined ? undefined : parseXYZTrajectory(string(storedScene.trajectory, 'trajectory source'));
  const trajectoryFrame = trajectory ? number(storedScene.trajectoryFrame ?? 0, 'trajectory frame', 0, trajectory.frames.length-1) : undefined;
  if (trajectory && (kind !== 'xyz' || !Number.isInteger(trajectoryFrame) || trajectory.frames[0].atoms.length !== structure.atoms.length
    || trajectory.frames[0].atoms.some((a,i) => { const b=structure.atoms[i]; return a.element!==b.element || Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)>1e-5; }))) {
    throw new Error('Project trajectory must match its XYZ structure and use a valid frame index.');
  }
  const storedCrystal = kind === 'crystal' ? object(storedScene.crystal, 'crystal source') : undefined;
  if (storedCrystal && storedCrystal.format !== 'cif' && storedCrystal.format !== 'poscar') throw new Error('Project crystal format is invalid.');
  const crystal = storedCrystal ? parseCrystal(string(storedCrystal.source, 'crystal source'), storedCrystal.format as 'cif' | 'poscar') : undefined;
  if (crystal && (crystal.atoms.length !== structure.atoms.length || crystal.atoms.some((atom, index) => {
    const other = structure.atoms[index];
    return atom.element !== other.element || Math.hypot(atom.x-other.x, atom.y-other.y, atom.z-other.z) > 1e-5;
  }))) throw new Error('Project crystal and stored structure do not match.');
  const volumes: Record<string, ParsedCube> = Object.create(null);
  for (const [id, cube] of Object.entries(object(document.volumes, 'embedded volumes'))) {
    identifier(id, 'volume ID');
    const volume = parseCube(string(cube, `volume ${id}`));
    matchingGeometry(structure, volume);
    volumes[id] = volume;
  }
  const volumeId = storedScene.volumeId === undefined ? undefined : identifier(storedScene.volumeId, 'selected volume ID');
  const volume = volumeId === undefined ? undefined : volumes[volumeId];
  if (((kind === 'xyz' || kind === 'crystal') && (volumeId !== undefined || Object.keys(volumes).length)) || ((kind === 'demo' || kind === 'cube') && !volume)) {
    throw new Error('Project selected volume data is missing or inconsistent with its scene.');
  }
  const manifest = document.manifest === undefined ? undefined : manifestMetadata(document.manifest);
  let orbital = storedScene.orbital === undefined ? undefined : orbitalMetadata(storedScene.orbital);
  if (kind === 'demo') {
    if (!manifest || !orbital) throw new Error('Project example metadata or selected orbital is missing.');
    const selected = manifest.orbitals.find(item => item.id === orbital!.id);
    if (!selected || volumeId !== selected.id) throw new Error('Project selected orbital is missing or inconsistent.');
    if (manifest.orbitals.length !== Object.keys(volumes).length || manifest.orbitals.some(item => !volumes[item.id])) {
      throw new Error('Project must embed complete volume data for every example orbital.');
    }
    orbital = selected;
  } else if (manifest || orbital || (kind === 'cube' && Object.keys(volumes).length !== 1)) {
    throw new Error('Project imported scene contains inconsistent example data.');
  }
  const camera = normalizeCameraState(document.camera);
  if (!camera) throw new Error('Project camera is missing or invalid.');
  if (document.theme !== 'light' && document.theme !== 'dark') throw new Error('Project theme is missing or invalid.');
  const colors = object(document.colors, 'orbital colors');
  return {
    scene: {
      key: string(storedScene.key, 'scene key'), name: string(storedScene.name, 'scene name'),
      formula: string(storedScene.formula, 'scene formula'), fileName: string(storedScene.fileName, 'source filename'),
      kind, structure, ...(volume ? { volume } : {}), ...(orbital ? { orbital } : {}), ...(crystal ? { crystal } : {}),
      ...(trajectory ? { trajectory, trajectoryFrame } : {}),
    },
    ...(manifest ? { manifest, volumes } : {}), settings: displaySettings(document.settings),
    colors: loadOrbitalColors({ getItem: () => JSON.stringify(colors) }), camera, theme: document.theme,
    ...(document.namedViews === undefined ? {} : { namedViews: normalizeNamedViews(document.namedViews) }),
  };
}

function checkSize(text: string): void {
  if (text.length > MAX_PROJECT_BYTES || new TextEncoder().encode(text).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('Project files must be 200 MB or smaller.');
  }
}

/** Project URLs retain provenance only; reopening uses the embedded fields. */
export function parseProject(text: string): ProjectSnapshot {
  checkSize(text);
  let document: unknown;
  try { document = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error('The project file is not valid JSON.'); }
  return readDocument(document);
}

export function serializeProject(snapshot: ProjectSnapshot): string {
  const { scene, manifest, settings, colors, camera, theme } = snapshot;
  const volumes: Record<string, string> = Object.create(null);
  for (const [id, volume] of Object.entries(snapshot.volumes ?? {})) volumes[id] = volume.cube;
  let volumeId: string | undefined;
  if (scene.volume) {
    volumeId = scene.kind === 'demo' ? scene.orbital?.id : 'current';
    if (!volumeId) throw new Error('Select an orbital before saving this example.');
    if (volumes[volumeId] !== undefined && volumes[volumeId] !== scene.volume.cube) {
      throw new Error('Project selected orbital does not match its embedded volume.');
    }
    volumes[volumeId] = scene.volume.cube;
  }
  const document = {
    format: PROJECT_FORMAT, version: PROJECT_VERSION,
    scene: { key: scene.key, name: scene.name, formula: scene.formula, kind: scene.kind,
      fileName: scene.fileName, xyz: scene.structure.xyz, volumeId, orbital: scene.orbital,
      ...(scene.trajectory ? { trajectory: scene.trajectory.source, trajectoryFrame: scene.trajectoryFrame ?? 0 } : {}),
      ...(scene.crystal ? { crystal: { source: scene.crystal.source, format: scene.crystal.format } } : {}) },
    manifest, volumes, settings, colors, camera, theme, namedViews: snapshot.namedViews,
  };
  // The same validation applies before saving and after opening a file.
  const normalized = readDocument(document);
  const text = JSON.stringify({ ...document, settings: normalized.settings, colors: normalized.colors, camera: normalized.camera, namedViews: normalized.namedViews }, null, 2);
  checkSize(text);
  return text;
}

export function projectFileName(name: string): string {
  const base = name.replace(/(?:\.iboview\.json|\.xyz|\.cub|\.cube|\.json)$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120).trim();
  return `${base || 'IboView project'}${PROJECT_EXTENSION}`;
}

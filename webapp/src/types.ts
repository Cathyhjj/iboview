import type { ParsedCube, ParsedStructure } from './lib/importers';

export interface Orbital {
  id: string;
  label: string;
  description: string;
  type?: string;
  occupation: number;
  energyHartree?: number;
  cubeUrl: string;
  isovalue: number;
}

export interface DemoManifest {
  id: string;
  name: string;
  description?: string;
  formula: string;
  xyzUrl: string;
  defaultOrbitalId: string;
  source: { file: string; description: string };
  method: string;
  isovalueMin?: number;
  grid: { spacingBohr: number };
  orbitals: Orbital[];
}

export interface Scene {
  key: string;
  name: string;
  formula: string;
  structure: ParsedStructure;
  volume?: ParsedCube;
  kind: 'demo' | 'cube' | 'xyz';
  fileName: string;
  orbital?: Orbital;
}

export interface DisplaySettings {
  isovalue: number;
  opacity: number;
  surface: boolean;
  hydrogens: boolean;
  labels: boolean;
  style: 'ball-stick' | 'stick' | 'space-fill';
  spinning: boolean;
  material: 'shiny' | 'soft' | 'extra';
  positiveColor: string;
  negativeColor: string;
}

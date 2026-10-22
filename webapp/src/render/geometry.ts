/* Ported from IboView IvIsoSurface.cpp and IvMesh.cpp.
 * Copyright (c) 2015 Gerald Knizia. GPL-3.0; see the repository LICENSE.
 * Element data: IvDataOptions.cpp and Common/CxAtomData.cpp.
 */
import type { Atom, ParsedCube } from '../lib/importers';
import { nativeElementHex } from '../lib/element-colors';
import { DEFAULT_MOLECULE_APPEARANCE, moleculeAtomColor, type MoleculeAppearance } from '../lib/molecule-appearance';
import { buildOrbitalTailCoordinates, orbitalTailWeight } from './orbital-tail';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface OrbitalMeshData extends MeshData {
  positiveVertexCount: number;
  tailWeights?: Float32Array;
  tailCoordinates?: Float32Array;
}

type Vec3 = [number, number, number];
type Color = [number, number, number, number];
const BOHR = 0.52917721092;
const ELEMENTS = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
const COVALENT_RADII = [0.0,   0.7181,   0.6047,   2.5322,
   1.7008,   1.5496,   1.4551,   1.4173,   1.3795,   1.3417,   1.3039,   2.9102,
   2.4566,   2.2299,   2.0976,   2.0031,   1.9275,   1.8708,   1.8330,   3.7039,
   3.2881,   2.7212,   2.5700,   2.3622,   2.4000,   2.6267,   2.3622,   2.3811,
   2.2866,   2.6078,   2.4755,   2.3811,   2.3055,   2.2488,   2.1921,   2.1543,
   2.0787,   3.9873,   3.6283,   3.0614,   2.7968,   2.5889,   2.7401,   2.9480,
   2.3811,   2.5511,   2.4755,   2.8913,   2.7968,   2.7212,   2.6645,   2.6078,
   2.5511,   2.5133,   2.4566,   4.2519,   3.7417,   3.1936,   3.4355,   3.4469,
   3.4280,   3.4658,   3.4091,   3.4091,   3.4091,   3.3505,   3.3656,   3.3297,
   3.3278,   3.3240,   3.3259,   3.0236,   2.8346,   2.6078,   2.7590,   3.0047,
   2.4188,   2.5889,   2.4188,   2.7212,   2.8157,   2.7968,   2.7779,   2.7590,
   2.8300,   2.9200,   2.7401,   5.4400,   4.7500,   3.7500,   3.3826,   3.0803,
   2.9480,   2.9291,   3.0047,   3.2692,   3.2881,   3.2125,   3.5149,   3.5149,
   3.2400,   3.1900,   3.1700,   3.2100,   3.2000,   3.2000,   3.2000,   3.2000,
   3.2000,   3.2000,   3.2000,   3.2000,   3.2000,   3.2000,   3.2000,   3.2000,
   3.2000,   3.2000,   3.2000
];
const VDW_RADII = [0.0,   2.2677,   2.6456,   3.4393,   2.8913,
   3.6283,   3.2125,   2.9291,   2.8724,   2.7779,   2.9102,   4.2897,   3.2692,
   3.4771,   3.9684,   3.4015,   3.4015,   3.3070,   3.5527,   5.1967,   4.3653,
   3.9873,   4.8566,   4.7621,   4.4031,   4.5731,   4.2708,   4.1952,   3.0803,
   2.6456,   2.6267,   3.5338,   3.9873,   3.4960,   3.5905,   3.4960,   3.8172,
   5.7259,   4.7054,   5.1778,   5.0645,   4.7432,   4.6109,   4.5542,   4.4787,
   4.4031,   3.0803,   3.2503,   2.9858,   3.6472,   4.1007,   3.8928,   3.8928,
   3.7417,   4.0818,   6.4818,   5.0645,   5.3668,   5.3290,   5.4046,   5.3668,
   5.3479,   5.2912,   5.2912,   5.2345,   5.2156,   5.1967,   5.1590,   5.1401,
   5.1212,   5.2345,   5.1023,   4.9889,   4.8755,   4.7810,   4.7054,   4.6109,
   4.4031,   3.3070,   3.1369,   2.9291,   3.7039,   3.8172,   3.9117,   3.7228,
   3.8172,   4.1574,   6.5762,   5.3479,   5.5369,   5.4613,   5.3857,   3.5149,
   5.2912,   5.2534,   5.2156,   5.2156,  -1.0000,  -1.0000,  -1.0000,  -1.0000,
   -1.0000,  -1.0000,  -1.0000,  -1.0000,  -1.0000,  -1.0000,  -1.0000,
   -1.0000,  -1.0000,  -1.0000,  -1.0000,  -1.0000,  -1.0000,  -1.0000,
   -1.0000,  -1.0000,   3.2000,   3.2000
];
const DRAW_RADII = [0, 0.87,1.60,2.52,2.03,1.58,1.43,1.32,1.29,1.26,1.74,2.91,2.69,2.35,2.11,2.08,2.04,1.97,1.95,3.69,3.33,2.86,2.67,2.65,2.54,2.61,2.52,2.35,2.20,2.46,2.25,2.38,2.26,2.29,2.25,2.25,2.17,4.27,3.88,3.21,2.96,2.78,2.80,2.50,2.79,2.52,2.53,2.62,2.65,2.76,2.64,2.66,2.62,2.61,2.39,4.86,4.30,3.67,3.48,3.44,3.43,3.40,3.36,3.35,3.28,3.27,3.23,3.20,3.16,3.14,3.09,3.16,3.04,2.86,2.88,2.59,2.59,2.59,2.58,2.38,2.53,2.87,2.76,2.86,2.83,2.92,2.68,5.44,4.75,3.75,3.25,3.23,3.18,3.15,3.13,3.14,3.40,3.33,3.31,3.26,3.24,3.19,3.17,3.21];

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);
  return length > 1e-30 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 1];
};
const color = (hex: number): Color => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255, 1];

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  vertex(position: Vec3, normal: Vec3, rgba: Color): number {
    const index = this.positions.length / 3;
    this.positions.push(...position);
    this.normals.push(...normal);
    this.colors.push(...rgba);
    return index;
  }

  finish(): MeshData {
    return {
      positions: new Float32Array(this.positions), normals: new Float32Array(this.normals),
      colors: new Float32Array(this.colors), indices: new Uint32Array(this.indices),
    };
  }
}

const ICOSA_VERTICES: Vec3[] = [
  [0.85065080835203999, 0, 0.52573111211913359], [0.85065080835203999, 0, -0.52573111211913359],
  [-0.85065080835203999, 0, 0.52573111211913359], [-0.85065080835203999, 0, -0.52573111211913359],
  [0, 0.52573111211913359, 0.85065080835203999], [0, -0.52573111211913359, 0.85065080835203999],
  [0, 0.52573111211913359, -0.85065080835203999], [0, -0.52573111211913359, -0.85065080835203999],
  [0.52573111211913359, 0.85065080835203999, 0], [-0.52573111211913359, 0.85065080835203999, 0],
  [0.52573111211913359, -0.85065080835203999, 0], [-0.52573111211913359, -0.85065080835203999, 0],
];
const ICOSA_FACES: Vec3[] = [[0,1,8],[0,4,5],[0,5,10],[0,8,4],[0,10,1],[1,6,8],[1,7,6],[1,10,7],[2,3,11],[2,4,9],[2,5,4],[2,9,3],[2,11,5],[3,6,7],[3,7,11],[3,9,6],[4,8,9],[5,11,10],[6,9,8],[7,10,11]];

function makeUnitSphere(): { vertices: Vec3[]; triangles: Vec3[] } {
  const vertices = ICOSA_VERTICES.map((v) => [...v] as Vec3);
  let triangles = ICOSA_FACES;
  for (let level = 0; level < 3; level += 1) {
    const midpointCache = new Map<string, number>();
    const midpoint = (i: number, j: number): number => {
      const key = `${Math.min(i, j)}:${Math.max(i, j)}`;
      const existing = midpointCache.get(key);
      if (existing !== undefined) return existing;
      const a = vertices[i], b = vertices[j];
      const index = vertices.length;
      vertices.push(unit([a[0] + b[0], a[1] + b[1], a[2] + b[2]]));
      midpointCache.set(key, index);
      return index;
    };
    const next: Vec3[] = [];
    for (const [a, b, c] of triangles) {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push([ca, a, ab], [b, bc, ab], [ab, bc, ca], [ca, bc, c]);
    }
    triangles = next;
  }
  return { vertices, triangles };
}
const SPHERE = makeUnitSphere();

function addSphere(mesh: MeshBuilder, center: Vec3, radius: number, rgba: Color): void {
  const offset = mesh.positions.length / 3;
  for (const normal of SPHERE.vertices) {
    mesh.vertex([center[0] + normal[0] * radius, center[1] + normal[1] * radius, center[2] + normal[2] * radius], normal, rgba);
  }
  for (const triangle of SPHERE.triangles) mesh.indices.push(offset + triangle[0], offset + triangle[1], offset + triangle[2]);
}

function addHalfBond(mesh: MeshBuilder, start: Vec3, end: Vec3, drawRadius: number, atomRadius: number, rgba: Color, tapered: boolean, radius: number): void {
  const delta: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const distance = Math.hypot(...delta);
  const hiddenOffset = 0.95 * Math.sqrt(Math.max(0, atomRadius * atomRadius - radius * radius));
  const offset = tapered ? Math.min(0.12 * drawRadius * BOHR, hiddenOffset) : 0;
  const height = distance / 2 - offset;
  if (height <= 1e-8) return;
  const w = unit(delta), u = unit(cross(Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0], w)), v = cross(w, u);
  const topRadius = radius * (tapered ? 0.72 : 1);
  const slant = Math.hypot(height, topRadius - radius);
  const radialNormal = height / slant, axialNormal = (radius - topRadius) / slant;
  const base = mesh.positions.length / 3;
  for (let ring = 0; ring < 2; ring += 1) {
    for (let index = 0; index < 16; index += 1) {
      const angle = 2 * Math.PI * index / 16;
      const radial: Vec3 = [0, 1, 2].map((axis) => u[axis] * Math.cos(angle) + v[axis] * Math.sin(angle)) as Vec3;
      const position = [0, 1, 2].map((axis) => start[axis] + w[axis] * (offset + ring * height) + radial[axis] * (ring ? topRadius : radius)) as Vec3;
      const normal = [0, 1, 2].map((axis) => radial[axis] * radialNormal + w[axis] * axialNormal) as Vec3;
      mesh.vertex(position, normal, rgba);
    }
  }
  for (let index = 0; index < 16; index += 1) {
    const next = (index + 1) % 16;
    mesh.indices.push(base + index, base + next, base + index + 16, base + index + 16, base + next, base + next + 16);
  }
  if (radius > atomRadius + 1e-10) {
    const normal: Vec3 = [-w[0], -w[1], -w[2]];
    const center = mesh.vertex(start, normal, rgba);
    for (let index = 0; index < 16; index += 1) {
      const source = (base + index) * 3;
      mesh.vertex([mesh.positions[source], mesh.positions[source + 1], mesh.positions[source + 2]], normal, rgba);
    }
    for (let index = 0; index < 16; index += 1) {
      mesh.indices.push(center, center + 1 + (index + 1) % 16, center + 1 + index);
    }
  }
}

/** Native IboView element colors, subdivision spheres, and geometric bond criterion. */
export function buildMolecule(atoms: Atom[], options: Pick<MoleculeAppearance, 'hydrogens' | 'style'> & Partial<MoleculeAppearance>): MeshData {
  const mesh = new MeshBuilder();
  const positiveScale = (value: number | undefined) => Number.isFinite(value) && value! > 0 ? value! : 1;
  const atomScale = positiveScale(options.atomScale), hydrogenScale = positiveScale(options.hydrogenScale);
  const bondScale = positiveScale(options.bondScale);
  const bondRadius = 0.28 * BOHR * bondScale * (options.style === 'wireframe' ? 0.28 : 1);
  const uniformBondColor = options.bondColorMode === 'uniform'
    ? color(Number.parseInt((/^#[\da-f]{6}$/i.test(options.bondColor ?? '') ? options.bondColor! : DEFAULT_MOLECULE_APPEARANCE.bondColor).slice(1), 16)) : undefined;
  const visible = atoms.filter((atom) => options.hydrogens || atom.element !== 'H').map((atom) => {
    const number = ELEMENTS.indexOf(atom.element) + 1;
    const position: Vec3 = [atom.x, atom.y, atom.z];
    if (number < 1 || position.some((value) => !Number.isFinite(value))) throw new Error('Cannot build molecular geometry from invalid atoms.');
    const drawRadius = DRAW_RADII[number] ?? 2;
    const vdw = VDW_RADII[number] > 0 ? VDW_RADII[number] : 3.2;
    const baseRadius = options.style === 'space-fill' ? vdw * BOHR
      : options.style === 'stick' || options.style === 'wireframe' ? bondRadius : 0.4 * drawRadius * BOHR;
    return { position, drawRadius, covalent: COVALENT_RADII[number] ?? 3.2,
      radius: baseRadius * atomScale * (atom.element === 'H' ? hydrogenScale : 1),
      rgba: color(moleculeAtomColor(atom.element, nativeElementHex(atom.element), options)) };
  });
  for (const atom of visible) {
    addSphere(mesh, atom.position, atom.radius, atom.rgba);
  }
  if (options.bonds !== false && options.style !== 'space-fill' && options.style !== 'spheres') {
    const tapered = options.style !== 'wireframe' && (options.bondStyle ? options.bondStyle === 'tapered' : options.style === 'ball-stick');
    for (let i = 0; i < visible.length; i += 1) {
      for (let j = i + 1; j < visible.length; j += 1) {
        const a = visible[i], b = visible[j];
        const distance = Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1], a.position[2] - b.position[2]);
        if (distance <= 1e-8 || distance > 1.3 * (a.covalent + b.covalent) * BOHR) continue;
        addHalfBond(mesh, a.position, b.position, a.drawRadius, a.radius, uniformBondColor ?? a.rgba, tapered, bondRadius);
        addHalfBond(mesh, b.position, a.position, b.drawRadius, b.radius, uniformBondColor ?? b.rgba, tapered, bondRadius);
      }
    }
  }
  return mesh.finish();
}

interface Grid { origin: Vec3; axes: Vec3[]; dimensions: Vec3; values: Float64Array; reciprocal: Vec3[]; determinant: number }
const gridCache = new WeakMap<ParsedCube, Grid>();

function readGrid(parsed: ParsedCube): Grid {
  const cached = gridCache.get(parsed);
  if (cached) return cached;
  const lines = parsed.cube.split('\n');
  const row = (index: number): number[] => lines[index].trim().split(/\s+/).map(Number);
  const header = row(2);
  const origin = header.slice(1, 4).map((value) => value * BOHR) as Vec3;
  const axes = [3, 4, 5].map((index) => row(index).slice(1).map((value) => value * BOHR) as Vec3);
  const reciprocal = [cross(axes[1], axes[2]), cross(axes[2], axes[0]), cross(axes[0], axes[1])];
  const determinant = dot(axes[0], reciprocal[0]);
  if (!Number.isFinite(determinant) || determinant === 0) throw new Error('The Cube grid basis must span three dimensions.');
  for (const vector of reciprocal) for (let axis = 0; axis < 3; axis += 1) vector[axis] /= determinant;
  const values = Float64Array.from(lines.slice(6 + header[0]).join(' ').trim().split(/\s+/), Number);
  const grid: Grid = { origin, axes, reciprocal, determinant, dimensions: parsed.dimensions, values };
  gridCache.set(parsed, grid);
  return grid;
}

// Original GTS-style cube edge numbering and face traversal from IvIsoSurface.cpp.
const EDGE_COORDS = [[0,0,0,0],[0,0,0,1],[0,0,1,1],[0,0,1,0],[1,0,0,0],[1,0,0,1],[1,1,0,1],[1,1,0,0],[2,0,0,0],[2,1,0,0],[2,1,1,0],[2,0,1,0]];
const EDGE_LINKS = [
  [[9,1,8],[6,2,5],[10,3,11],[7,0,4],[3,7,0],[11,4,8],[2,5,1],[10,6,9],[5,11,4],[1,8,0],[6,9,7],[2,10,3]],
  [[4,3,7],[8,0,9],[5,1,6],[11,2,10],[8,5,11],[1,6,2],[9,7,10],[0,4,3],[0,9,1],[7,10,6],[3,11,2],[4,8,5]],
];

function traceSurface(mesh: MeshBuilder, grid: Grid, iso: number, rgba: Color): void {
  const { origin, axes, dimensions: [nx, ny, nz], values, reciprocal } = grid;
  const stride = [ny * nz, nz, 1];
  const node = (x: number, y: number, z: number): number => (x * ny + y) * nz + z;
  const gradient = (x: number, y: number, z: number): Vec3 => {
    const coordinate = [x, y, z], dimensions = [nx, ny, nz], index = node(x, y, z);
    const result: Vec3 = [0, 0, 0];
    for (let axis = 0; axis < 3; axis += 1) {
      const minus = coordinate[axis] > 0 ? 1 : 0, plus = coordinate[axis] < dimensions[axis] - 1 ? 1 : 0;
      const derivative = plus + minus ? (values[index + plus * stride[axis]] - values[index - minus * stride[axis]]) / (plus + minus) : 0;
      for (let component = 0; component < 3; component += 1) result[component] += reciprocal[axis][component] * derivative;
    }
    return result;
  };
  const vertexCache = new Map<number, number>();
  const edgeTypes = new Uint8Array(12), edgeVertices = new Uint32Array(12), handled = new Uint8Array(12);
  const reverse = (iso > 0) !== (grid.determinant < 0);
  for (let z = 0; z < nz - 1; z += 1) {
    for (let y = 0; y < ny - 1; y += 1) {
      for (let x = 0; x < nx - 1; x += 1) {
        const base = node(x, y, z);
        let low = Infinity, high = -Infinity;
        for (let dx = 0; dx < 2; dx += 1) for (let dy = 0; dy < 2; dy += 1) for (let dz = 0; dz < 2; dz += 1) {
          const value = values[base + dx * stride[0] + dy * stride[1] + dz];
          low = Math.min(low, value); high = Math.max(high, value);
        }
        if (low >= iso || high < iso) continue;
        edgeTypes.fill(0); handled.fill(0);
        for (let edge = 0; edge < 12; edge += 1) {
          const [axis, dx, dy, dz] = EDGE_COORDS[edge];
          const coordinate = [x + dx, y + dy, z + dz];
          const first = node(coordinate[0], coordinate[1], coordinate[2]), second = first + stride[axis];
          const dA = values[first] - iso, dB = values[second] - iso;
          const left = dA >= 0 && dB < 0, right = dA < 0 && dB >= 0;
          if (!left && !right) continue;
          edgeTypes[edge] = left ? 1 : 2;
          const key = first * 3 + axis;
          let index = vertexCache.get(key);
          if (index === undefined) {
            const fraction = dA / (dA - dB);
            const gA = gradient(coordinate[0], coordinate[1], coordinate[2]);
            coordinate[axis] += 1;
            const gB = gradient(coordinate[0], coordinate[1], coordinate[2]);
            coordinate[axis] += fraction - 1;
            const position: Vec3 = [0, 1, 2].map((component) => origin[component] + axes[0][component] * coordinate[0] + axes[1][component] * coordinate[1] + axes[2][component] * coordinate[2]) as Vec3;
            let interpolated = [0, 1, 2].map((component) => gA[component] * (1 - fraction) + gB[component] * fraction) as Vec3;
            if (Math.hypot(...interpolated) < 1e-30) interpolated = axes[axis].map((component) => component * (dB - dA)) as Vec3;
            const sign = iso > 0 ? -1 : 1;
            const normal = unit(interpolated).map((component) => component * sign) as Vec3;
            index = mesh.vertex(position, normal, rgba);
            vertexCache.set(key, index);
          }
          edgeVertices[edge] = index;
        }
        for (let firstEdge = 0; firstEdge < 12; firstEdge += 1) {
          if (handled[firstEdge] || !edgeTypes[firstEdge]) continue;
          const face: number[] = [];
          let current = firstEdge;
          while (!handled[current] && edgeTypes[current]) {
            face.push(edgeVertices[current]);
            handled[current] = 1;
            const links = EDGE_LINKS[edgeTypes[current] - 1][current];
            for (const linked of links) {
              current = linked;
              if (edgeTypes[current]) break;
            }
          }
          for (let triangle = 1; triangle < face.length - 1; triangle += 1) {
            const a = face[0], b = face[triangle], c = face[triangle + 1];
            const ab: Vec3 = [0, 1, 2].map((component) => mesh.positions[b * 3 + component] - mesh.positions[a * 3 + component]) as Vec3;
            const ac: Vec3 = [0, 1, 2].map((component) => mesh.positions[c * 3 + component] - mesh.positions[a * 3 + component]) as Vec3;
            if (Math.hypot(...cross(ab, ac)) < 1e-20) continue;
            mesh.indices.push(a, reverse ? c : b, reverse ? b : c);
          }
        }
      }
    }
  }
}

/** Both signed isosurfaces using IboView's native cube-edge topology. */
export function buildOrbital(parsed: ParsedCube, isovalue: number): OrbitalMeshData {
  if (!Number.isFinite(isovalue) || isovalue <= 0) throw new Error('Orbital isovalue must be a positive finite number.');
  const mesh = new MeshBuilder();
  const grid = readGrid(parsed);
  if (isovalue >= parsed.range[0] && isovalue <= parsed.range[1]) traceSurface(mesh, grid, isovalue, color(0x6353e6));
  const positiveVertexCount = mesh.positions.length / 3;
  if (-isovalue >= parsed.range[0] && -isovalue <= parsed.range[1]) traceSurface(mesh, grid, -isovalue, color(0x24c8c4));
  const result: OrbitalMeshData = { ...mesh.finish(), positiveVertexCount };
  result.tailCoordinates = buildOrbitalTailCoordinates(result.positions, result.indices, positiveVertexCount, parsed.atoms);
  result.tailWeights = result.tailCoordinates.map((coordinate) => orbitalTailWeight(coordinate));
  return result;
}

/** Positive vertices precede negative vertices, even when either phase is absent. */
export function recolorOrbital(
  mesh: OrbitalMeshData, positiveColor: string, negativeColor: string,
  gradient?: { positive: readonly string[]; negative: readonly string[]; extent?: number },
): void {
  const parse = (hex: string): Color => {
    if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('Orbital colors must use six-digit hexadecimal values.');
    return color(Number.parseInt(hex.slice(1), 16));
  };
  const phases = [positiveColor, negativeColor].map(parse);
  const ramps = [gradient?.positive, gradient?.negative].map((samples, phase) => {
    const ramp = samples?.map(parse) ?? [];
    ramp[0] = phases[phase];
    return ramp;
  });
  const requestedExtent = gradient?.extent ?? 0.2;
  const extent = Number.isFinite(requestedExtent) ? Math.max(0, Math.min(1, requestedExtent)) : 0.2;
  for (let vertex = 0; vertex < mesh.colors.length / 4; vertex += 1) {
    const ramp = ramps[vertex < mesh.positiveVertexCount ? 0 : 1];
    const weight = mesh.tailCoordinates
      ? orbitalTailWeight(mesh.tailCoordinates[vertex], extent)
      : extent === 0.2 ? mesh.tailWeights?.[vertex] ?? 0 : 0;
    const position = (Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0) * (ramp.length - 1);
    const index = Math.floor(position), fraction = position - index;
    const start = ramp[index], end = ramp[Math.min(index + 1, ramp.length - 1)];
    for (let channel = 0; channel < 3; channel += 1) {
      mesh.colors[vertex * 4 + channel] = start[channel] * (1 - fraction) + end[channel] * fraction;
    }
  }
}

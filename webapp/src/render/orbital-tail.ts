import type { Atom } from '../lib/importers';

type Vec3 = [number, number, number];
interface Component {
  vertices: number[];
  center: Vec3;
  min: Vec3;
  max: Vec3;
  area: number;
}

/** Normalized outward positions; -1 marks components without a stable direction. */
export function buildOrbitalTailCoordinates(
  positions: Float32Array, indices: Uint32Array, positiveVertexCount: number, atoms: readonly Atom[],
): Float32Array {
  const count = positions.length / 3;
  const coordinates = new Float32Array(count).fill(-1);
  if (!count || !atoms.length) return coordinates;
  const atomCenter: Vec3 = [0, 0, 0];
  for (const atom of atoms) {
    atomCenter[0] += atom.x / atoms.length;
    atomCenter[1] += atom.y / atoms.length;
    atomCenter[2] += atom.z / atoms.length;
  }
  if (!atomCenter.every(Number.isFinite)) return coordinates;

  const parents = Uint32Array.from({ length: count }, (_, index) => index);
  const ranks = new Uint8Array(count);
  const find = (vertex: number): number => {
    while (parents[vertex] !== vertex) {
      parents[vertex] = parents[parents[vertex]];
      vertex = parents[vertex];
    }
    return vertex;
  };
  const join = (a: number, b: number) => {
    if ((a < positiveVertexCount) !== (b < positiveVertexCount)) return;
    let first = find(a), second = find(b);
    if (first === second) return;
    if (ranks[first] < ranks[second]) [first, second] = [second, first];
    parents[second] = first;
    if (ranks[first] === ranks[second]) ranks[first] += 1;
  };
  for (let index = 0; index < indices.length; index += 3) {
    join(indices[index], indices[index + 1]);
    join(indices[index], indices[index + 2]);
  }

  const components = new Map<number, Component>();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const root = find(vertex);
    let component = components.get(root);
    if (!component) {
      component = { vertices: [], center: [0, 0, 0], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], area: 0 };
      components.set(root, component);
    }
    component.vertices.push(vertex);
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[vertex * 3 + axis];
      component.min[axis] = Math.min(component.min[axis], value);
      component.max[axis] = Math.max(component.max[axis], value);
    }
  }
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index], b = indices[index + 1], c = indices[index + 2];
    const root = find(a);
    if (find(b) !== root || find(c) !== root) continue;
    const ab = [0, 1, 2].map((axis) => positions[b * 3 + axis] - positions[a * 3 + axis]);
    const ac = [0, 1, 2].map((axis) => positions[c * 3 + axis] - positions[a * 3 + axis]);
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    const component = components.get(root)!;
    component.area += area;
    for (let axis = 0; axis < 3; axis += 1) {
      component.center[axis] += area * (positions[a * 3 + axis] + positions[b * 3 + axis] + positions[c * 3 + axis]) / 3;
    }
  }

  for (const component of components.values()) {
    if (!Number.isFinite(component.area) || component.area <= 1e-20) continue;
    const outward = component.center.map((value, axis) => value / component.area - atomCenter[axis]);
    const length = Math.hypot(...outward);
    const diagonal = Math.hypot(...component.max.map((value, axis) => value - component.min[axis]));
    // Nearly centered components have no stable outward direction.
    if (!Number.isFinite(length) || length <= Math.max(1e-7, diagonal * 1e-3)) continue;
    const axis = outward.map((value) => value / length);
    const project = (vertex: number): number => axis.reduce((sum, value, index) => sum + value * (positions[vertex * 3 + index] - atomCenter[index]), 0);
    let min = Infinity, max = -Infinity;
    for (const vertex of component.vertices) {
      const projection = project(vertex);
      min = Math.min(min, projection);
      max = Math.max(max, projection);
    }
    const span = max - min;
    if (!Number.isFinite(span) || span <= Math.max(1e-7, diagonal * 1e-6)) continue;
    for (const vertex of component.vertices) {
      coordinates[vertex] = Math.max(0, Math.min(1, (project(vertex) - min) / span));
    }
  }
  return coordinates;
}

export function orbitalTailWeight(coordinate: number, extent = 0.2): number {
  const span = Number.isFinite(extent) ? Math.max(0, Math.min(1, extent)) : 0.2;
  if (!span || !Number.isFinite(coordinate) || coordinate < 0) return 0;
  const tail = Math.max(0, Math.min(1, (coordinate - (1 - span)) / span));
  return tail * tail * (3 - 2 * tail);
}

/** Camera-independent tint weights over the outer portion of each connected lobe. */
export function buildOrbitalTailWeights(
  positions: Float32Array, indices: Uint32Array, positiveVertexCount: number, atoms: readonly Atom[], extent = 0.2,
): Float32Array {
  return buildOrbitalTailCoordinates(positions, indices, positiveVertexCount, atoms)
    .map((coordinate) => orbitalTailWeight(coordinate, extent));
}

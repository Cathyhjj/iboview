import type { Atom } from './importers';
import type { CrystalData, Vec3 } from './crystal';

export interface Neighbor { atom: Atom; site: number; image: Vec3; distance: number; shell: number }
export interface CoordinationShell { id: number; element: string; count: number; min: number; max: number; mean: number }
export interface CoordinationResult { center: Atom; cutoff: number; tolerance: number; periodic: boolean; neighbors: Neighbor[]; shells: CoordinationShell[] }
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const dot = (a: Vec3, b: Vec3) => a.reduce((s, n, i) => s + n*b[i], 0);

export function analyzeCoordination(atoms: Atom[], centerIndex: number, cutoff: number, tolerance: number, crystal?: CrystalData, element = ''): CoordinationResult {
  const center = atoms[centerIndex];
  if (!center) throw new Error('Select a center atom.');
  if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 12) throw new Error('Choose a cutoff above 0 and up to 12 Å.');
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) throw new Error('Choose a shell tolerance from 0 to 1 Å.');
  const neighbors: Neighbor[] = [];
  const sites = crystal?.atoms ?? atoms;
  let candidates = 0;
  let dual: Vec3[] | undefined;
  if (crystal) {
    const [a,b,c] = crystal.cell, det = dot(a,cross(b,c));
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('The unit cell is singular.');
    dual = [cross(b,c),cross(c,a),cross(a,b)].map(v => v.map(n => n/det) as Vec3);
  }
  for (let site = 0; site < sites.length; site++) {
    const atom = sites[site];
    if (element && atom.element !== element) continue;
    const displacement: Vec3 = [atom.x-center.x, atom.y-center.y, atom.z-center.z];
    const ranges = dual?.map(v => {
      const f = dot(v,displacement), extent = cutoff*Math.hypot(...v);
      return [Math.ceil(-extent-f-1e-9), Math.floor(extent-f+1e-9)];
    }) ?? [[0,0],[0,0],[0,0]];
    candidates += ranges.reduce((n,[min,max]) => n*Math.max(0,max-min+1),1);
    if (candidates > 1_000_000) throw new Error('This cutoff requires too many periodic images. Reduce the cutoff or use a less skewed equivalent cell.');
    for (let i=ranges[0][0]; i<=ranges[0][1]; i++) for (let j=ranges[1][0]; j<=ranges[1][1]; j++) for (let k=ranges[2][0]; k<=ranges[2][1]; k++) {
      const image: Vec3 = [i,j,k];
      const p = displacement.map((n,axis) => n + (crystal ? image.reduce((s,t,l) => s+t*crystal.cell[l][axis],0) : 0)) as Vec3;
      const distance = Math.hypot(...p);
      if (distance < 1e-7 || distance > cutoff+1e-9) continue;
      if (neighbors.length >= 10_000) throw new Error('More than 10,000 neighbors fall inside the cutoff. Reduce the cutoff.');
      neighbors.push({ atom: { element: atom.element, x:p[0], y:p[1], z:p[2] }, site, image, distance, shell: -1 });
    }
  }
  neighbors.sort((a,b) => a.distance-b.distance || a.atom.element.localeCompare(b.atom.element) || a.site-b.site);
  const shells: CoordinationShell[] = [];
  const latest = new Map<string,CoordinationShell>();
  for (const neighbor of neighbors) {
    const element = neighbor.atom.element;
    let shell = latest.get(element);
    if (!shell || neighbor.distance-shell.min > tolerance+1e-9) {
      shell = { id:shells.length, element, count:0, min:neighbor.distance, max:neighbor.distance, mean:0 };
      shells.push(shell); latest.set(element,shell);
    }
    neighbor.shell=shell.id; shell.count++; shell.max=neighbor.distance;
    shell.mean += (neighbor.distance-shell.mean)/shell.count;
  }
  return { center, cutoff, tolerance, periodic:!!crystal, neighbors, shells };
}

export function coordinationXYZ(result: CoordinationResult, source: string): string {
  const atoms = [{ ...result.center, x:0, y:0, z:0 }, ...result.neighbors.map(n => n.atom)];
  return `${atoms.length}\n${source.replace(/[\r\n]/g,' ')}; center=${result.center.element}; cutoff=${result.cutoff} Angstrom; periodic=${result.periodic}; center at origin\n${atoms.map(a => `${a.element} ${a.x.toFixed(8)} ${a.y.toFixed(8)} ${a.z.toFixed(8)}`).join('\n')}\n`;
}
export function coordinationCSV(result: CoordinationResult): string {
  const header = 'element,unit_cell_site,image_a,image_b,image_c,distance_A,shell,x_relative_A,y_relative_A,z_relative_A';
  return header+'\n'+result.neighbors.map(n => [n.atom.element,n.site+1,...n.image,n.distance.toFixed(8),n.shell+1,n.atom.x.toFixed(8),n.atom.y.toFixed(8),n.atom.z.toFixed(8)].join(',')).join('\n')+'\n';
}

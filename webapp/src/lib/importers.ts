export interface Atom {
  element: string;
  x: number;
  y: number;
  z: number;
}

export interface ParsedStructure {
  atoms: Atom[];
  xyz: string;
}

export interface ParsedCube extends ParsedStructure {
  cube: string;
  dimensions: [number, number, number];
  range: [number, number];
}

// IboView physical unit conversion (CxPhysicalUnits.h).
const BOHR_TO_ANGSTROM = 0.52917721092;
const ATOM_LIMIT = 2_000;
const VOXEL_LIMIT = 5_000_000;
const COORDINATE_LIMIT = 10_000;
const ELEMENTS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce ' +
  'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn ' +
  'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');
const ELEMENT_LOOKUP = new Map(ELEMENTS.map((element) => [element.toLowerCase(), element]));
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/;

function fields(line: string | undefined): string[] {
  const trimmed = line?.trim() ?? '';
  return trimmed ? trimmed.split(/\s+/) : [];
}

function readNumber(token: string | undefined, label: string): number {
  if (!token || !NUMBER_PATTERN.test(token)) {
    throw new Error(`${label} must be a finite number.`);
  }
  const value = Number(token.replace(/[dD]/, 'e'));
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value;
}

function readInteger(token: string | undefined, label: string): number {
  if (!token || !/^[+-]?\d+$/.test(token)) {
    throw new Error(`${label} must be an integer.`);
  }
  const value = Number(token);
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is too large.`);
  return value;
}

function atomCount(count: number): number {
  if (count < 1 || count >= ATOM_LIMIT) {
    throw new Error(`Please use a structure with 1–${ATOM_LIMIT - 1} atoms.`);
  }
  return count;
}

function coordinate(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT) {
    throw new Error(`${label} must be within ±${COORDINATE_LIMIT.toLocaleString('en-US')} Å.`);
  }
  return value;
}

function makeXYZ(atoms: Atom[], comment: string): string {
  return `${atoms.length}\n${comment}\n${atoms.map((atom) => `${atom.element} ${atom.x} ${atom.y} ${atom.z}`).join('\n')}\n`;
}

function sourceLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
}

/** Parse a single XYZ frame. Returned coordinates are in angstroms. */
export function parseXYZ(text: string): ParsedStructure {
  const lines = sourceLines(text);
  const header = fields(lines[0]);
  if (header.length !== 1) throw new Error('An XYZ file must start with its atom count.');
  const count = atomCount(readInteger(header[0], 'XYZ atom count'));
  if (lines.length < count + 2) throw new Error(`XYZ is incomplete: expected ${count} atom rows after the comment line.`);
  const atoms: Atom[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = fields(lines[index + 2]);
    if (row.length !== 4) throw new Error(`XYZ atom ${index + 1}: expected element x y z.`);
    const element = ELEMENT_LOOKUP.get(row[0].toLowerCase());
    if (!element) throw new Error(`XYZ atom ${index + 1}: unknown element “${row[0]}”.`);
    const values = row.slice(1).map((token, axis) => coordinate(readNumber(token, `XYZ atom ${index + 1} coordinate ${axis + 1}`), `XYZ atom ${index + 1}`));
    atoms.push({ element, x: values[0], y: values[1], z: values[2] });
  }
  if (lines.slice(count + 2).some((line) => line.trim())) {
    throw new Error('This viewer supports one XYZ frame at a time. Remove extra frames or atom rows.');
  }
  return { atoms, xyz: makeXYZ(atoms, lines[1]) };
}

/** Parse a single scalar Cube field, canonicalized to positive-count Bohr units. */
export function parseCube(text: string): ParsedCube {
  const lines = sourceLines(text);
  if (lines.length < 7) throw new Error('Cube is incomplete: expected two comments, an origin, three grid axes, and atoms.');
  const header = fields(lines[2]);
  if (header.length < 4 || header.length > 5) throw new Error('Cube origin must contain atom count, x, y, z, and an optional value count.');
  const signedCount = readInteger(header[0], 'Cube atom count');
  const count = atomCount(Math.abs(signedCount));
  if (header.length === 5 && readInteger(header[4], 'Cube value count') !== 1) {
    throw new Error('Multi-field Cube files are not supported. Export one orbital or scalar field per file.');
  }
  const origin = header.slice(1, 4).map((token) => readNumber(token, 'Cube origin'));
  const axes = [3, 4, 5].map((line, axis) => {
    const row = fields(lines[line]);
    if (row.length !== 4) throw new Error(`Cube grid axis ${axis + 1} must contain a count and three vector components.`);
    const signedSize = readInteger(row[0], `Cube grid axis ${axis + 1} count`);
    if (signedSize === 0) throw new Error('Cube grid counts must be nonzero.');
    return { signedSize, vector: row.slice(1).map((token) => readNumber(token, `Cube grid axis ${axis + 1}`)) };
  });
  const isAngstrom = axes[0].signedSize < 0;
  if (axes.some((axis) => (axis.signedSize < 0) !== isAngstrom)) {
    throw new Error('Cube grid axes mix unit signs. Use all positive counts (Bohr) or all negative counts (Å).');
  }
  const dimensions = axes.map((axis) => Math.abs(axis.signedSize)) as [number, number, number];
  const voxelCount = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(voxelCount) || voxelCount >= VOXEL_LIMIT) {
    throw new Error('This viewer supports Cube grids with fewer than 5,000,000 points. Export a coarser grid.');
  }
  const toAngstrom = isAngstrom ? 1 : BOHR_TO_ANGSTROM;
  const toBohr = isAngstrom ? 1 / BOHR_TO_ANGSTROM : 1;
  const vectors = axes.map((axis) => axis.vector);
  const [a, b, c] = vectors;
  const determinant = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const vectorProduct = Math.hypot(...a) * Math.hypot(...b) * Math.hypot(...c);
  if (!Number.isFinite(determinant) || vectorProduct === 0 || Math.abs(determinant) <= 1e-10 * vectorProduct) {
    throw new Error('Cube grid vectors must be nonzero and span three dimensions.');
  }
  // Check all grid corners, including skewed grids and negative step vectors.
  for (let corner = 0; corner < 8; corner += 1) {
    for (let component = 0; component < 3; component += 1) {
      let position = origin[component];
      for (let axis = 0; axis < 3; axis += 1) {
        if (corner & (1 << axis)) position += vectors[axis][component] * (dimensions[axis] - 1);
      }
      coordinate(position * toAngstrom, 'Cube grid');
    }
  }
  const atoms: Atom[] = [];
  const atomRows: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = fields(lines[index + 6]);
    if (row.length !== 5) throw new Error(`Cube atom ${index + 1}: expected atomic number, charge, x, y, z.`);
    const atomicNumber = readInteger(row[0], `Cube atom ${index + 1} atomic number`);
    if (atomicNumber < 1 || atomicNumber > ELEMENTS.length) {
      throw new Error(`Cube atom ${index + 1}: atomic number must be between 1 and ${ELEMENTS.length}. Ghost atoms are not supported.`);
    }
    const charge = readNumber(row[1], `Cube atom ${index + 1} charge`);
    const position = row.slice(2).map((token) => readNumber(token, `Cube atom ${index + 1} coordinate`));
    const [x, y, z] = position.map((value) => coordinate(value * toAngstrom, `Cube atom ${index + 1}`));
    atoms.push({ element: ELEMENTS[atomicNumber - 1], x, y, z });
    atomRows.push(`${atomicNumber} ${charge} ${position.map((value) => value * toBohr).join(' ')}`);
  }
  const data = fields(lines.slice(count + 6).join(' '));
  let dataOffset = 0;
  if (signedCount < 0) {
    const fieldCount = readInteger(data[0], 'Cube orbital count');
    if (fieldCount !== 1) throw new Error('Multi-orbital Cube files are not supported. Export one orbital per file.');
    readInteger(data[1], 'Cube orbital identifier');
    dataOffset = 2;
  }
  const availableValues = data.length - dataOffset;
  if (availableValues !== voxelCount) {
    throw new Error(`Cube field size mismatch: expected ${voxelCount.toLocaleString('en-US')} values, found ${Math.max(0, availableValues).toLocaleString('en-US')}. Export a complete single-field Cube file.`);
  }
  let minimum = Infinity;
  let maximum = -Infinity;
  const dataLines: string[] = [];
  let currentLine: string[] = [];
  for (let index = dataOffset; index < data.length; index += 1) {
    const value = readNumber(data[index], `Cube field value ${index - dataOffset + 1}`);
    if (!Number.isFinite(Math.fround(value))) throw new Error('Cube field contains values outside the renderer’s numeric range.');
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    currentLine.push(data[index].replace(/[dD]/, 'E'));
    if (currentLine.length === 6) {
      dataLines.push(currentLine.join(' '));
      currentLine = [];
    }
  }
  if (currentLine.length) dataLines.push(currentLine.join(' '));
  const cube = [
    lines[0], lines[1],
    `${count} ${origin.map((value) => value * toBohr).join(' ')}`,
    ...axes.map((axis) => `${Math.abs(axis.signedSize)} ${axis.vector.map((value) => value * toBohr).join(' ')}`),
    ...atomRows, ...dataLines,
  ].join('\n');
  return { atoms, xyz: makeXYZ(atoms, 'Structure from Cube; coordinates in angstroms'), cube, dimensions, range: [minimum, maximum] };
}

/** Molecular formula in Hill order, using ordinary digits for counts. */
export function formulaFor(atoms: Atom[]): string {
  const counts = new Map<string, number>();
  for (const atom of atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  const ordered = [...counts.keys()].sort();
  if (counts.has('C')) {
    ordered.splice(ordered.indexOf('C'), 1);
    if (counts.has('H')) ordered.splice(ordered.indexOf('H'), 1);
    ordered.unshift(...(counts.has('H') ? ['C', 'H'] : ['C']));
  }
  return ordered.map((element) => `${element}${counts.get(element) === 1 ? '' : counts.get(element)}`).join('');
}

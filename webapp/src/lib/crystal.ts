import type { Atom } from './importers';

export type Vec3 = [number, number, number];
export interface CrystalData {
  /** Lattice vectors and unit-cell Cartesian atom positions in angstroms. */
  cell: [Vec3, Vec3, Vec3];
  atoms: Atom[];
  name?: string;
  source: string;
  format: 'cif' | 'poscar';
}
type Cell = CrystalData['cell'];
type Symmetry = { matrix: Cell; offset: Vec3 };
type Token = { value: string; quoted: boolean };
type Block = { name: string; columns: Map<string, string[]> };
const ATOM_LIMIT = 1999;
const ELEMENTS = new Set(('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce ' +
  'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn ' +
  'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og').split(' '));
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?$/;
const identity = (): Symmetry => ({ matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], offset: [0, 0, 0] });
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const determinant = (cell: Cell): number => dot(cell[0], cross(cell[1], cell[2]));
const cartesian = (cell: Cell, f: Vec3): Vec3 => [0, 1, 2].map((axis) => cell[0][axis] * f[0] + cell[1][axis] * f[1] + cell[2][axis] * f[2]) as Vec3;
const fractional = (cell: Cell, p: Vec3): Vec3 => {
  const det = determinant(cell);
  return [dot(p, cross(cell[1], cell[2])) / det, dot(p, cross(cell[2], cell[0])) / det, dot(p, cross(cell[0], cell[1])) / det];
};
const wrap = (value: number): number => {
  const result = value - Math.floor(value);
  return result < 1e-10 || result > 1 - 1e-10 ? 0 : result;
};

function numeric(token: string | undefined, label: string): number {
  const clean = token?.replace(/^(.*?)(\(\d+\))([eEdD][+-]?\d+)?$/, '$1$3');
  if (!clean || !NUMBER.test(clean)) throw new Error(label + ' must be a finite number (not ? or .).');
  const value = Number(clean.replace(/[dD]/, 'e'));
  if (!Number.isFinite(value)) throw new Error(label + ' must be a finite number.');
  return value;
}
function coordinateRounding(token: string): number {
  const clean = token.replace(/^(.*?)(\(\d+\))([eEdD][+-]?\d+)?$/, '$1$3').replace(/[dD]/, 'e');
  const [mantissa, exponent = '0'] = clean.toLowerCase().split('e');
  const resolution = 10 ** (Number(exponent) - (mantissa.split('.')[1]?.length ?? 0));
  // Coarse coordinates do not provide enough precision to infer a special position.
  return resolution <= 1e-5 ? resolution / 2 : 0;
}
function matchingComponents(matches: Uint8Array[], candidates: number[]): number[][] {
  const result: number[][] = [];
  const visited = new Set<number>();
  for (const start of candidates) {
    if (visited.has(start)) continue;
    const component = [start];
    visited.add(start);
    for (let next = 0; next < component.length; next += 1) for (const candidate of candidates) {
      if (matches[component[next]][candidate] && !visited.has(candidate)) {
        visited.add(candidate); component.push(candidate);
      }
    }
    result.push(component);
  }
  return result;
}
function bounded(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > 10_000) throw new Error(label + ' must be within ±10,000 Å.');
  return value;
}
function validateCell(cell: Cell): void {
  if (!Array.isArray(cell) || cell.length !== 3 || cell.some((v) => !Array.isArray(v) || v.length !== 3)) throw new Error('A crystal needs three lattice vectors.');
  cell.forEach((v) => v.forEach((n) => bounded(n, 'Lattice vector')));
  const product = cell.reduce((value, v) => value * Math.hypot(...v), 1);
  if (!product || Math.abs(determinant(cell)) <= product * 1e-10) throw new Error('Lattice vectors must be nonzero and span three dimensions.');
}
function element(token: string | undefined, fromLabel = false): string {
  const match = token?.match(fromLabel ? /^([A-Z][a-z]?)(?:[^a-zA-Z]|$)/ : /^([A-Za-z]{1,2})(?:(?:\d*[+-])|(?:[+-]\d+))?$/);
  const symbol = match ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : '';
  if (!ELEMENTS.has(symbol)) throw new Error('Unknown or ambiguous element “' + (token ?? '') + '”. Supply explicit chemical element symbols.');
  return symbol;
}
function atom(symbol: string, position: Vec3): Atom {
  return { element: symbol, x: bounded(position[0], 'Atom coordinate'), y: bounded(position[1], 'Atom coordinate'), z: bounded(position[2], 'Atom coordinate') };
}
function checkCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 1 || count > ATOM_LIMIT) throw new Error('Please use a crystal or supercell with 1–1999 atoms.');
}

function tokenize(source: string): Token[] {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.startsWith('#\\#CIF_2.0')) throw new Error('CIF 2.0 is not supported. Export a CIF 1.1 file.');
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    if (/\s/.test(text[index])) { index += 1; continue; }
    if (text[index] === '#') {
      while (index < text.length && text[index] !== '\n') index += 1;
      continue;
    }
    if (text[index] === ';' && (index === 0 || text[index - 1] === '\n')) {
      const end = text.indexOf('\n;', index + 1);
      if (end < 0) throw new Error('CIF has an unterminated semicolon text field.');
      tokens.push({ value: text.slice(index + 1, end), quoted: true });
      index = end + 2;
      if (index < text.length && !/\s/.test(text[index])) throw new Error('CIF semicolon delimiter must end its line.');
      continue;
    }
    const quote = text[index] === "'" || text[index] === '"' ? text[index] : '';
    const start = index + (quote ? 1 : 0);
    index = start;
    if (quote) {
      while (index < text.length && !(text[index] === quote && (index + 1 === text.length || /\s/.test(text[index + 1])))) {
        if (text[index] === '\n') throw new Error('CIF quoted strings must close on the same line.');
        index += 1;
      }
      if (index === text.length) throw new Error('CIF has an unterminated quoted string.');
    } else {
      while (index < text.length && !/\s/.test(text[index])) index += 1;
    }
    tokens.push({ value: text.slice(start, index), quoted: Boolean(quote) });
    if (quote) index += 1;
  }
  return tokens;
}
const tagName = (value: string): string => value.toLowerCase().replace(/\./g, '_');
const control = (token: Token): boolean => !token.quoted && /^(?:_|data_|loop_$|stop_$|save_|global_$)/i.test(token.value);
function cifBlocks(source: string): Block[] {
  const tokens = tokenize(source);
  const blocks: Block[] = [];
  let block: Block | undefined;
  let index = 0;
  const put = (name: string, values: string[]) => {
    if (!block) throw new Error('CIF data must belong to a data_ block.');
    if (block.columns.has(name)) throw new Error('CIF repeats the data item ' + name + '.');
    block.columns.set(name, values);
  };
  while (index < tokens.length) {
    const token = tokens[index++];
    const key = tagName(token.value);
    if (!token.quoted && key.startsWith('data_')) {
      block = { name: token.value.slice(5), columns: new Map() };
      blocks.push(block);
    } else if (!token.quoted && key === 'loop_') {
      const names: string[] = [];
      while (index < tokens.length && !tokens[index].quoted && tokens[index].value.startsWith('_')) names.push(tagName(tokens[index++].value));
      if (!names.length) throw new Error('CIF loop has no column names.');
      const values: string[] = [];
      while (index < tokens.length && !control(tokens[index])) values.push(tokens[index++].value);
      if (!values.length || values.length % names.length) throw new Error('CIF loop is incomplete: each row must have one value per column.');
      names.forEach((name, column) => put(name, values.filter((_value, i) => i % names.length === column)));
      if (index < tokens.length && !tokens[index].quoted && tokens[index].value.toLowerCase() === 'stop_') index += 1;
    } else if (!token.quoted && key.startsWith('_')) {
      if (index >= tokens.length || control(tokens[index])) throw new Error('CIF ' + key + ' has no value.');
      put(key, [tokens[index++].value]);
    } else {
      throw new Error('Unsupported or misplaced CIF token “' + token.value + '”. Export a structure without save frames.');
    }
  }
  return blocks;
}

function expression(text: string): { coefficients: Vec3; constant: number } {
  const clean = text.toLowerCase().replace(/\s+/g, '');
  if (!clean || !/^[xyz0-9+*/.\-]+$/.test(clean)) throw new Error('Unsupported CIF symmetry expression “' + text + '”.');
  const terms = clean.match(/[+-]?[^+-]+/g) ?? [];
  if (terms.join('') !== clean) throw new Error('Malformed CIF symmetry expression “' + text + '”.');
  const coefficients: Vec3 = [0, 0, 0];
  let constant = 0;
  for (const signedTerm of terms) {
    const sign = signedTerm[0] === '-' ? -1 : 1;
    const term = signedTerm.replace(/^[+-]/, '');
    const variable = term.match(/^(?:(\d+)\*?)?([xyz])$/);
    if (variable) coefficients['xyz'.indexOf(variable[2])] += sign * Number(variable[1] ?? 1);
    else {
      const parts = term.split('/');
      if (parts.length > 2) throw new Error('Malformed CIF symmetry expression “' + text + '”.');
      const denominator = parts.length === 2 ? numeric(parts[1], 'Symmetry denominator') : 1;
      if (denominator <= 0) throw new Error('CIF symmetry denominators must be positive.');
      constant += sign * numeric(parts[0], 'Symmetry translation') / denominator;
    }
  }
  if (coefficients.some((v) => Math.abs(v) > 3) || !Number.isFinite(constant) || Math.abs(constant) > 100) throw new Error('CIF symmetry operation is outside the supported range.');
  return { coefficients, constant: wrap(constant) };
}
function parseSymmetry(text: string): Symmetry {
  const rows = text.split(',');
  if (rows.length !== 3) throw new Error('CIF symmetry operations must contain three coordinates, for example x,y,z.');
  const parsed = rows.map(expression);
  const operation: Symmetry = { matrix: parsed.map((row) => row.coefficients) as Cell, offset: parsed.map((row) => row.constant) as Vec3 };
  if (Math.abs(determinant(operation.matrix)) !== 1) throw new Error('CIF symmetry rotation must have determinant +1 or −1.');
  return operation;
}
function symmetryKey(operation: Symmetry): string {
  return operation.matrix.flat().join(',') + ';' + operation.offset.map((v) => Math.round(wrap(v) * 1e6) % 1e6).join(',');
}
function validateSymmetry(operations: Symmetry[], cell: Cell): Symmetry[] {
  if (!operations.length || operations.length > 384) throw new Error('CIF must have between 1 and 384 symmetry operations.');
  const unique = new Map(operations.map((operation) => [symmetryKey(operation), operation]));
  if (!unique.has(symmetryKey(identity()))) throw new Error('CIF symmetry operations must include the identity x,y,z.');
  const result = [...unique.values()];
  for (const operation of result) {
    const rotated = [0, 1, 2].map((axis) => cartesian(cell, operation.matrix.map((row) => row[axis]) as Vec3));
    for (let i = 0; i < 3; i += 1) for (let j = 0; j < 3; j += 1) {
      const scale = Math.hypot(...cell[i]) * Math.hypot(...cell[j]);
      if (Math.abs(dot(rotated[i], rotated[j]) - dot(cell[i], cell[j])) > scale * 2e-3) throw new Error('CIF symmetry operations are inconsistent with the lattice dimensions or angles.');
    }
    for (const second of result) {
      const matrix = operation.matrix.map((row) => [0, 1, 2].map((axis) => dot(row, second.matrix.map((r) => r[axis]) as Vec3))) as Cell;
      const offset = operation.matrix.map((row, axis) => dot(row, second.offset) + operation.offset[axis]) as Vec3;
      if (!unique.has(symmetryKey({ matrix, offset }))) throw new Error('CIF symmetry list is incomplete. Export all symmetry operations, including centring translations.');
    }
  }
  return result;
}

function parseCif(source: string): CrystalData {
  const candidates = cifBlocks(source).filter((block) => [...block.columns.keys()].some((key) => key.startsWith('_atom_site_fract_') || key.startsWith('_atom_site_cartn_')));
  if (candidates.length !== 1) throw new Error('CIF must contain exactly one crystal structure. Export the desired data block separately.');
  const { name, columns } = candidates[0];
  const value = (...names: string[]): string | undefined => names.map((key) => columns.get(key)?.[0]).find((v) => v !== undefined && v !== '.' && v !== '?');
  const [a, b, c] = ['a', 'b', 'c'].map((axis) => numeric(value('_cell_length_' + axis), 'Cell length ' + axis));
  const [alpha, beta, gamma] = ['alpha', 'beta', 'gamma'].map((angle) => numeric(value('_cell_angle_' + angle), 'Cell angle ' + angle));
  if ([a, b, c].some((length) => length <= 0) || [alpha, beta, gamma].some((angle) => angle <= 0 || angle >= 180)) throw new Error('CIF cell lengths must be positive and angles must be between 0° and 180°.');
  const radians = Math.PI / 180;
  const cx = c * Math.cos(beta * radians);
  const cy = c * (Math.cos(alpha * radians) - Math.cos(beta * radians) * Math.cos(gamma * radians)) / Math.sin(gamma * radians);
  const czSquared = c * c - cx * cx - cy * cy;
  if (czSquared <= c * c * 1e-12) throw new Error('CIF cell angles do not define a three-dimensional lattice.');
  const cell: Cell = [[a, 0, 0], [b * Math.cos(gamma * radians), b * Math.sin(gamma * radians), 0], [cx, cy, Math.sqrt(czSquared)]];
  validateCell(cell);
  const coordinates = ['x', 'y', 'z'].map((axis) => columns.get('_atom_site_fract_' + axis));
  if (coordinates.some((column) => !column)) throw new Error('CIF requires fractional atom coordinates (_atom_site_fract_x/y/z). Export fractional coordinates.');
  const count = coordinates[0]!.length;
  checkCount(count);
  const symbols = columns.get('_atom_site_type_symbol');
  const labels = columns.get('_atom_site_label');
  const occupancy = columns.get('_atom_site_occupancy');
  const disorder = columns.get('_atom_site_disorder_group');
  const multiplicity = columns.get('_atom_site_symmetry_multiplicity') ?? columns.get('_atom_site_site_symmetry_multiplicity');
  if (!symbols && !labels) throw new Error('CIF needs atom type symbols or unambiguous atom labels.');
  if ([...coordinates, symbols, labels, occupancy, disorder, multiplicity].some((column) => column && column.length !== count)) throw new Error('CIF atom-site columns have inconsistent lengths.');
  const rawOperations = columns.get('_space_group_symop_operation_xyz') ?? columns.get('_symmetry_equiv_pos_as_xyz');
  const groupNumber = value('_space_group_it_number', '_symmetry_int_tables_number');
  const groupName = value('_space_group_name_h-m_alt', '_symmetry_space_group_name_h-m');
  const hall = value('_space_group_name_hall', '_symmetry_space_group_name_hall');
  const isP1 = (v: string): boolean => v.replace(/\s+/g, '').toLowerCase() === 'p1';
  const declaresP1 = groupNumber === '1' || (groupName !== undefined && isP1(groupName)) || (hall !== undefined && isP1(hall));
  const declaresOther = (groupNumber !== undefined && groupNumber !== '1') || (groupName !== undefined && !isP1(groupName)) || (hall !== undefined && !isP1(hall));
  if (declaresP1 && declaresOther) throw new Error('CIF space-group declarations disagree about P1 symmetry.');
  if (!rawOperations && (!declaresP1 || declaresOther)) throw new Error('CIF lacks explicit symmetry operations. Export all symmetry operations, or an explicitly declared P1 structure.');
  const operations = validateSymmetry(rawOperations ? rawOperations.map(parseSymmetry) : [identity()], cell);
  if ((declaresP1 && operations.length !== 1) || (declaresOther && operations.length === 1)) throw new Error('CIF symmetry operations disagree with the declared space group.');
  const sites: { element: string; f: Vec3; images: Vec3[] }[] = [];
  const delta = (left: Vec3, right: Vec3): Vec3 => left.map((n, axis) => {
    const d = n - right[axis]; return d - Math.round(d);
  }) as Vec3;
  const samePosition = (left: Vec3, right: Vec3): boolean => Math.hypot(...cartesian(cell, delta(left, right))) < 1e-5;
  for (let index = 0; index < count; index += 1) {
    const occupied = occupancy ? numeric(occupancy[index], 'CIF site occupancy') : 1;
    if (occupied === 0) continue;
    if (Math.abs(occupied - 1) > 1e-8 || (disorder && !['.', '?', '0'].includes(disorder[index]))) throw new Error('Partially occupied or disordered CIF sites are not supported. Export a fully occupied ordered structure.');
    const symbol = symbols ? element(symbols[index]) : element(labels![index], true);
    const f = coordinates.map((column, axis) => numeric(column![index], 'CIF fractional coordinate')) as Vec3;
    if (f.some((n) => Math.abs(n) > 1e6)) throw new Error('CIF fractional coordinates are outside the supported range.');
    const rounding = coordinates.map((column) => coordinateRounding(column![index]));
    const images = operations.map((operation) => operation.matrix.map((row, axis) => wrap(dot(row, f) + operation.offset[axis])) as Vec3);
    const matches = images.map(() => new Uint8Array(images.length));
    const strictMatches = images.map(() => new Uint8Array(images.length));
    for (let left = 0; left < images.length; left += 1) for (let right = left; right < images.length; right += 1) {
      const difference = delta(images[left], images[right]);
      const strictMatch = samePosition(images[left], images[right]);
      // Both images share the same rounded input; propagate its error through R1 − R2.
      const match = strictMatch || (Math.hypot(...cartesian(cell, difference)) <= 1e-3
        && difference.every((d, axis) => Math.abs(d) <= 1e-12 + operations[left].matrix[axis].reduce((bound, coefficient, component) =>
          bound + Math.abs(coefficient - operations[right].matrix[axis][component]) * rounding[component], 0)));
      matches[left][right] = matches[right][left] = Number(match);
      strictMatches[left][right] = strictMatches[right][left] = Number(strictMatch);
    }
    const components = matchingComponents(matches, images.map((_image, i) => i)).flatMap((component) => {
      if (component.every((left) => component.every((right) => matches[left][right]))) return [component];
      // Ambiguous rounding must retain the original strictly distinct symmetry images.
      const strict = matchingComponents(strictMatches, component);
      if (strict.some((group) => group.some((left) => group.some((right) => !strictMatches[left][right])))) {
        throw new Error('CIF symmetry positions are ambiguous at the recorded coordinate precision. Export more precise fractional coordinates.');
      }
      return strict;
    });
    const ownPositions = components.map((component) => ({ f: images[component[0]], images: component.map((image) => images[image]) }));
    if (multiplicity && numeric(multiplicity[index], 'CIF site multiplicity') !== ownPositions.length) throw new Error('CIF site multiplicity does not match its symmetry-expanded positions. Check the symmetry list and coordinates.');
    for (const position of ownPositions) {
      // Independent source sites still require a strict match of actual symmetry images.
      const previous = sites.find((site) => site.images.some((left) => position.images.some((right) => samePosition(left, right))));
      if (previous && previous.element !== symbol) throw new Error('CIF places different elements at the same site. Export an ordered structure.');
      if (!previous) sites.push({ element: symbol, f: position.f, images: position.images });
      if (sites.length > ATOM_LIMIT) checkCount(sites.length);
    }
  }
  checkCount(sites.length);
  return { cell, atoms: sites.map((site) => atom(site.element, cartesian(cell, site.f))), name: value('_chemical_name_common', '_chemical_name_systematic') ?? name, source, format: 'cif' };
}

function parsePoscar(source: string): CrystalData {
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const fields = (index: number): string[] => (lines[index] ?? '').split(/[!#]/, 1)[0].trim().split(/\s+/).filter(Boolean);
  if (lines.length < 8) throw new Error('POSCAR is incomplete: expected a comment, scale, lattice, species, counts, and coordinates.');
  const scaleValues = fields(1).map((token) => numeric(token, 'POSCAR scale'));
  if (scaleValues.length !== 1 && scaleValues.length !== 3) throw new Error('POSCAR requires one scaling factor or three positive Cartesian scaling factors.');
  const rawCell = [2, 3, 4].map((index) => {
    const row = fields(index);
    if (row.length !== 3) throw new Error('Each POSCAR lattice vector needs three components.');
    return row.map((token) => numeric(token, 'POSCAR lattice vector')) as Vec3;
  }) as Cell;
  validateCell(rawCell);
  let scale: Vec3;
  if (scaleValues.length === 1) {
    const s = scaleValues[0] < 0 ? Math.cbrt(-scaleValues[0] / Math.abs(determinant(rawCell))) : scaleValues[0];
    if (s <= 0 || !Number.isFinite(s)) throw new Error('POSCAR scale must be nonzero.');
    scale = [s, s, s];
  } else {
    if (scaleValues.some((s) => s <= 0)) throw new Error('All three POSCAR scaling factors must be positive.');
    scale = scaleValues as Vec3;
  }
  const cell = rawCell.map((row) => row.map((n, axis) => n * scale[axis])) as Cell;
  validateCell(cell);
  const species = fields(5);
  if (!species.length || species.every((s) => /^\d+$/.test(s))) throw new Error('POSCAR must include element symbols (VASP 5 format). Species cannot be inferred without a POTCAR.');
  const symbols = species.map((s) => element(s));
  const counts = fields(6).map((s) => {
    if (!/^\d+$/.test(s)) throw new Error('POSCAR atom counts must be nonnegative integers.');
    return Number(s);
  });
  if (counts.length !== symbols.length) throw new Error('POSCAR must have one atom count per species.');
  const count = counts.reduce((sum, n) => sum + n, 0);
  checkCount(count);
  let index = 7;
  const selective = /^s/i.test(lines[index]?.trim() ?? '');
  if (selective) index += 1;
  const mode = lines[index++]?.trim() ?? '';
  if (!/^[dck]/i.test(mode)) throw new Error('POSCAR coordinate mode must be Direct or Cartesian.');
  const direct = /^d/i.test(mode);
  const atoms: Atom[] = [];
  symbols.forEach((symbol, speciesIndex) => {
    for (let i = 0; i < counts[speciesIndex]; i += 1) {
      const row = fields(index++);
      if (row.length < (selective ? 6 : 3)) throw new Error('POSCAR atom ' + (atoms.length + 1) + ' is incomplete.');
      if (selective && row.slice(3, 6).some((flag) => !/^[tf]$/i.test(flag))) throw new Error('POSCAR selective-dynamics flags must be T or F.');
      const p = row.slice(0, 3).map((s) => numeric(s, 'POSCAR atom coordinate')) as Vec3;
      const f = direct ? p : fractional(cell, p.map((n, axis) => n * scale[axis]) as Vec3);
      if (f.some((n) => Math.abs(n) > 1e6)) throw new Error('POSCAR coordinates are outside the supported range.');
      atoms.push(atom(symbol, cartesian(cell, f.map(wrap) as Vec3)));
    }
  });
  return { cell, atoms, name: lines[0].trim(), source, format: 'poscar' };
}

/** Parse one ordered crystal. Coordinates are wrapped into its half-open unit cell. */
export function parseCrystal(text: string, format: 'cif' | 'poscar'): CrystalData {
  if (text.length > 20_000_000) throw new Error('Crystal file is too large. Please use a file smaller than 20 MB.');
  if (format === 'cif') return parseCif(text);
  if (format === 'poscar') return parsePoscar(text);
  throw new Error('Unsupported crystal format. Use CIF or POSCAR.');
}

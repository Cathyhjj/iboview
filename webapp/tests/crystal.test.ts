import { describe, expect, it } from 'vitest';
import { parseCrystal, type Vec3 } from '../src/lib/crystal';

const baseCif = [
  'data_test',
  '_cell_length_a 4.0(2)',
  '_cell_length_b 6',
  '_cell_length_c 8',
  '_cell_angle_alpha 90',
  '_cell_angle_beta 90',
  '_cell_angle_gamma 90',
  "_symmetry_space_group_name_H-M 'P 1'",
  'loop_',
  '_atom_site_label',
  '_atom_site_type_symbol',
  '_atom_site_fract_x',
  '_atom_site_fract_y',
  '_atom_site_fract_z',
  'C1 C 0.25 0.5 0.75',
].join('\n');
const poscar = [
  'Carbon oxide', '2', '2 0 0', '1 3 0', '0 0 4',
  'C O', '1 1', 'Direct', '.25 .5 .75', '-.25 1 .5',
].join('\n');
const symmetryCif = (operations: string[], atoms = 'C1 C .1 .2 .3'): string => baseCif
  .replace("_symmetry_space_group_name_H-M 'P 1'", "loop_\n_space_group_symop_operation_xyz\n" + operations.map((s) => "'" + s + "'").join('\n'))
  .replace('C1 C 0.25 0.5 0.75', atoms);
const p3Cif = (atoms = 'C1 C .33333 .66667 .25'): string => symmetryCif(['x,y,z', '-y,x-y,z', '-x+y,-x,z'], atoms)
  .replace('_cell_length_b 6', '_cell_length_b 4').replace('_cell_angle_gamma 90', '_cell_angle_gamma 120');
const coordinates = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];
function permutations<T>(values: T[]): T[][] {
  return values.length ? values.flatMap((value, index) => permutations(values.filter((_item, i) => i !== index)).map((rest) => [value, ...rest])) : [[]];
}

describe('CIF import', () => {
  it('keeps exact source and cell, parses uncertainties, and converts fractional coordinates', () => {
    const crystal = parseCrystal(baseCif, 'cif');
    expect(crystal.source).toBe(baseCif);
    expect(crystal.name).toBe('test');
    expect(crystal.format).toBe('cif');
    expect(crystal.atoms).toHaveLength(1);
    coordinates(crystal.atoms[0]).forEach((n, i) => expect(n).toBeCloseTo([1, 3, 6][i], 10));
    expect(crystal.cell[0]).toEqual([4, 0, 0]);
  });

  it('accepts mixed-case and dotted tags, comments, quoted labels and multiline metadata', () => {
    const source = '\uFEFF' + baseCif
      .replace('data_test', 'data_test\n_chemical_name_common\n;A # crystal\nwith two lines\n;\n# a comment')
      .replace('_cell_length_a 4.0(2)', '_CELL.LENGTH_A 4.0(2) # uncertainty')
      .replace('C1 C 0.25 0.5 0.75', "'C1' 'C' .25(1) 5e-1 7.5(2)e-1");
    const crystal = parseCrystal(source.replace(/\n/g, '\r\n'), 'cif');
    expect(crystal.name).toBe('A # crystal\nwith two lines');
    expect(crystal.atoms[0].z).toBeCloseTo(6);
  });

  it('preserves an oblique triclinic lattice instead of treating it as an orthogonal box', () => {
    const source = baseCif.replace('_cell_angle_alpha 90', '_cell_angle_alpha 80')
      .replace('_cell_angle_beta 90', '_cell_angle_beta 70')
      .replace('_cell_angle_gamma 90', '_cell_angle_gamma 60');
    const { cell, atoms } = parseCrystal(source, 'cif');
    const dot = (a: Vec3, b: Vec3) => a.reduce((sum, n, i) => sum + n * b[i], 0);
    expect(dot(cell[0], cell[1])).toBeCloseTo(4 * 6 * Math.cos(Math.PI / 3), 10);
    expect(dot(cell[0], cell[2])).toBeCloseTo(4 * 8 * Math.cos(70 * Math.PI / 180), 10);
    expect(dot(cell[1], cell[2])).toBeCloseTo(6 * 8 * Math.cos(80 * Math.PI / 180), 10);
    expect(atoms[0].x).toBeCloseTo(.25 * 4 + .5 * 3 + .75 * 8 * Math.cos(70 * Math.PI / 180), 10);
  });

  it('expands inversion and removes duplicate special positions and periodic copies', () => {
    const source = symmetryCif(['x,y,z', '-x,-y,-z'], 'C1 C .1 .2 .3\nO1 O 0 0 0\nC2 C 1.1 .2 .3');
    const crystal = parseCrystal(source, 'cif');
    expect(crystal.atoms).toHaveLength(3);
    expect(crystal.atoms.map((a) => a.element)).toEqual(['C', 'C', 'O']);
    expect(crystal.atoms[1].x).toBeCloseTo(3.6);
    expect(crystal.atoms[1].y).toBeCloseTo(4.8);
    expect(crystal.atoms[1].z).toBeCloseTo(5.6);
  });

  it('supports screw/glide translations and the legacy symmetry tag', () => {
    const source = symmetryCif(['x,y,z', '-x,y+1/2,-z+1/2']).replace('_space_group_symop_operation_xyz', '_symmetry_equiv_pos_as_xyz');
    const crystal = parseCrystal(source, 'cif');
    expect(crystal.atoms).toHaveLength(2);
    coordinates(crystal.atoms[1]).forEach((n, i) => expect(n).toBeCloseTo([3.6, 4.2, 1.6][i], 10));
  });

  it('supports mixed x-y terms in hexagonal symmetry and complete centring groups', () => {
    const source = symmetryCif(['x,y,z', '-y,x-y,z', '-x+y,-x,z'])
      .replace('_cell_length_b 6', '_cell_length_b 4').replace('_cell_angle_gamma 90', '_cell_angle_gamma 120');
    expect(parseCrystal(source, 'cif').atoms).toHaveLength(3);
    const centring = symmetryCif(['x,y,z', 'x+1/3,y,z', 'x+2/3,y,z']);
    expect(parseCrystal(centring, 'cif').atoms).toHaveLength(3);
  });

  it.each([false, true])('retains one rounded P3 special position with multiplicity supplied: %s', (withMultiplicity) => {
    const source = withMultiplicity
      ? p3Cif('C1 C .33333 .66667 .25 1').replace('_atom_site_fract_z\n', '_atom_site_fract_z\n_atom_site_symmetry_multiplicity\n')
      : p3Cif();
    const crystal = parseCrystal(source, 'cif');
    expect(crystal.atoms).toHaveLength(1);
    expect(crystal.atoms[0].x).toBeCloseTo(-.00002, 10);
    expect(crystal.atoms[0].y).toBeCloseTo(4 * Math.sin(Math.PI / 3) * .66667, 10);
    expect(parseCrystal(crystal.source, crystal.format)).toEqual(crystal);
  });

  it('derives special-position rounding from exponent and uncertainty notation', () => {
    expect(parseCrystal(p3Cif('C1 C 3.3333(2)e-1 6.6667D-1 .25'), 'cif').atoms).toHaveLength(1);
  });

  it('retains one rounded P3 special position in every symmetry-operation order', () => {
    for (const operations of permutations(['x,y,z', '-y,x-y,z', '-x+y,-x,z'])) {
      const source = symmetryCif(operations, 'C1 C .33333 .66667 .25')
        .replace('_cell_length_b 6', '_cell_length_b 4').replace('_cell_angle_gamma 90', '_cell_angle_gamma 120');
      expect(parseCrystal(source, 'cif').atoms).toHaveLength(1);
    }
  });

  it('keeps all six general positions when rounding is ambiguous in all 720 S3 operation orders', () => {
    const orders = permutations(['x,y,z', 'x,z,y', 'y,x,z', 'y,z,x', 'z,x,y', 'z,y,x']);
    expect(orders).toHaveLength(720);
    let expected: string[] | undefined;
    for (const operations of orders) {
      const source = symmetryCif(operations, 'C1 C .12345 .123454 .123446')
        .replace('_cell_length_b 6', '_cell_length_b 4').replace('_cell_length_c 8', '_cell_length_c 4');
      const crystal = parseCrystal(source, 'cif');
      expect(crystal.atoms).toHaveLength(6);
      const positions = crystal.atoms.map((atom) => coordinates(atom).join(',')).sort();
      expected ??= positions;
      expect(positions).toEqual(expected);
    }
  });

  it('keeps independent nearby sites separate when their own symmetry images coincide within rounding', () => {
    const crystal = parseCrystal(p3Cif('C1 C .33333 .66667 .25\nC2 C .33333 .66667 .25001'), 'cif');
    expect(crystal.atoms).toHaveLength(2);
    expect(crystal.atoms[1].z - crystal.atoms[0].z).toBeCloseTo(.00008, 10);
  });

  it('still recognizes duplicate source rows represented by another rounded symmetry image', () => {
    expect(parseCrystal(p3Cif('C1 C .33333 .66667 .25\nC2 C .33333 .66666 .25'), 'cif').atoms).toHaveLength(1);
    expect(() => parseCrystal(p3Cif('C1 C .33333 .66667 .25\nO1 O .33333 .66666 .25'), 'cif')).toThrow(/different elements/);
  });

  it('preserves genuinely distinct near-special symmetry images beyond their input rounding bounds', () => {
    expect(parseCrystal(p3Cif('C1 C .333331 .666669 .25'), 'cif').atoms).toHaveLength(3);
    expect(parseCrystal(p3Cif('C1 C .33 .67 .25'), 'cif').atoms).toHaveLength(3);
    const boundary = symmetryCif(['x,y,z', '-x,-y,-z'], 'C1 C .99999 0 0');
    const crystal = parseCrystal(boundary, 'cif');
    expect(crystal.atoms).toHaveLength(2);
    expect(crystal.atoms[0].x).toBeCloseTo(3.99996, 10);
    expect(crystal.atoms[1].x).toBeCloseTo(.00004, 10);
  });

  it('does not use coordinate rounding to merge centring translations or distant images in large cells', () => {
    const centred = symmetryCif(['x,y,z', 'x+1/3,y,z', 'x+2/3,y,z'], 'C1 C .33333 .66667 .25');
    expect(parseCrystal(centred, 'cif').atoms).toHaveLength(3);
    const large = p3Cif().replace('_cell_length_a 4.0(2)', '_cell_length_a 1000').replace('_cell_length_b 4', '_cell_length_b 1000');
    expect(parseCrystal(large, 'cif').atoms).toHaveLength(3);
  });

  it('can infer elements from conventional atom labels and strips ionic charges from types', () => {
    const labelled = baseCif.replace('_atom_site_type_symbol\n', '').replace('C1 C 0.25', 'Cl12 0.25');
    expect(parseCrystal(labelled, 'cif').atoms[0].element).toBe('Cl');
    expect(parseCrystal(baseCif.replace('C1 C 0.25', 'Fe1 Fe3+ 0.25'), 'cif').atoms[0].element).toBe('Fe');
  });

  it('uses a single structural block even when a metadata block comes first', () => {
    expect(parseCrystal('data_metadata\n_audit_creation_method test\n' + baseCif, 'cif').atoms).toHaveLength(1);
  });

  it('supports fully occupied ordered sites and drops zero-occupancy sites', () => {
    const source = baseCif.replace('_atom_site_fract_z\n', '_atom_site_fract_z\n_atom_site_occupancy\n')
      .replace('C1 C 0.25 0.5 0.75', 'C1 C 0.25 0.5 0.75 1\nO1 O .1 .2 .3 0');
    expect(parseCrystal(source, 'cif').atoms).toHaveLength(1);
  });

  it.each([
    ['missing symmetry for non-P1', baseCif.replace("'P 1'", "'P 21/c'"), /lacks explicit symmetry/],
    ['unknown symmetry', baseCif.replace("_symmetry_space_group_name_H-M 'P 1'", ''), /lacks explicit symmetry/],
    ['identity-only non-P1', symmetryCif(['x,y,z']).replace('data_test', "data_test\n_symmetry_space_group_name_H-M 'P -1'"), /disagree/],
    ['contradictory group metadata', baseCif.replace('data_test', 'data_test\n_space_group_IT_number 2'), /disagree/],
    ['missing identity', symmetryCif(['-x,-y,-z']), /identity/],
    ['incomplete group', symmetryCif(['x,y,z', 'x+1/3,y,z']), /incomplete/],
    ['singular symmetry', symmetryCif(['x,y,z', 'x,x,z']), /determinant/],
    ['invalid metric', symmetryCif(['x,y,z', 'y,x,z']), /inconsistent with the lattice/],
    ['executable expression', symmetryCif(['x,y,z', 'alert(1),y,z']), /Unsupported/],
    ['zero denominator', symmetryCif(['x,y,z', 'x+1/0,y,z']), /denominators/],
    ['invalid cell', baseCif.replace('_cell_length_b 6', '_cell_length_b 0'), /positive/],
    ['impossible angles', baseCif.replace('_cell_angle_alpha 90', '_cell_angle_alpha 170').replace('_cell_angle_beta 90', '_cell_angle_beta 10'), /three-dimensional/],
    ['nonfinite coordinate', baseCif.replace('C1 C 0.25', 'C1 C NaN'), /finite number/],
    ['unknown coordinate', baseCif.replace('C1 C 0.25', 'C1 C ?'), /finite number/],
    ['bad element', baseCif.replace('C1 C 0.25', 'Xx1 Xx 0.25'), /Unknown/],
    ['incomplete loop', baseCif.replace('C1 C 0.25 0.5 0.75', 'C1 C 0.25'), /loop is incomplete/],
    ['repeated item', baseCif + '\n_cell_length_a 5', /repeats/],
    ['multiple structures', baseCif + '\n' + baseCif.replace('data_test', 'data_second'), /exactly one/],
    ['unterminated quote', baseCif.replace("'P 1'", "'P 1"), /quoted strings/],
    ['unterminated text field', baseCif + '\n_publ_section_comment\n;no end', /unterminated/],
    ['overlapping elements', symmetryCif(['x,y,z'], 'C1 C .1 .2 .3\nO1 O .1 .2 .3'), /different elements/],
    ['partial occupancy', baseCif.replace('_atom_site_fract_z\n', '_atom_site_fract_z\n_atom_site_occupancy\n') + ' 0.5', /Partially occupied/],
    ['disorder', baseCif.replace('_atom_site_fract_z\n', '_atom_site_fract_z\n_atom_site_disorder_group\n') + ' 1', /disordered/],
    ['wrong multiplicity', baseCif.replace('_atom_site_fract_z\n', '_atom_site_fract_z\n_atom_site_symmetry_multiplicity\n') + ' 2', /multiplicity/],
    ['CIF2', '#\\#CIF_2.0\n' + baseCif, /CIF 2.0/],
  ])('rejects %s', (_label, source, message) => {
    expect(() => parseCrystal(source, 'cif')).toThrow(message);
  });
});

describe('POSCAR import', () => {
  it('handles direct coordinates, nonorthogonal lattice vectors, and wrapping', () => {
    const crystal = parseCrystal(poscar, 'poscar');
    expect(crystal.cell).toEqual([[4, 0, 0], [2, 6, 0], [0, 0, 8]]);
    expect(crystal.atoms).toEqual([{ element: 'C', x: 2, y: 3, z: 6 }, { element: 'O', x: 3, y: 0, z: 4 }]);
    expect(crystal.source).toBe(poscar);
  });

  it('uses Cartesian scaling and selective-dynamics flags without treating them as coordinates', () => {
    const source = poscar.replace('Direct\n.25 .5 .75\n-.25 1 .5', 'Selective dynamics\nCartesian\n1 1.5 3 T F T\n1.5 0 2 F F F');
    expect(parseCrystal(source, 'poscar').atoms).toEqual(parseCrystal(poscar, 'poscar').atoms);
  });

  it('interprets negative scale as desired cell volume', () => {
    const source = poscar.replace('\n2\n', '\n-192\n');
    expect(parseCrystal(source, 'poscar').cell).toEqual(parseCrystal(poscar, 'poscar').cell);
  });

  it('applies three factors to Cartesian components, not to lattice vector indices', () => {
    const source = poscar.replace('\n2\n', '\n2 3 4\n');
    expect(parseCrystal(source, 'poscar').cell).toEqual([[4, 0, 0], [2, 9, 0], [0, 0, 16]]);
    const cart = source.replace('Direct\n.25 .5 .75\n-.25 1 .5', 'Cartesian\n1 1.5 3\n1.5 0 2');
    expect(parseCrystal(cart, 'poscar').atoms[0]).toEqual({ element: 'C', x: 2, y: 4.5, z: 12 });
  });

  it('handles left-handed input cells and Fortran D exponents', () => {
    const source = poscar.replace('0 0 4', '0 0 -4').replace('.25 .5 .75', '2.5D-1 .5 .75');
    expect(parseCrystal(source, 'poscar').atoms[0].z).toBe(-6);
  });

  it.each([
    ['zero scale', poscar.replace('\n2\n', '\n0\n'), /nonzero/],
    ['negative component scale', poscar.replace('\n2\n', '\n2 -3 4\n'), /positive/],
    ['two scale factors', poscar.replace('\n2\n', '\n2 3\n'), /one scaling factor/],
    ['dependent lattice vectors', poscar.replace('0 0 4', '0 3 0'), /span three dimensions/],
    ['missing species', poscar.replace('C O\n', ''), /VASP 5/],
    ['unknown species', poscar.replace('C O\n', 'Xx O\n'), /Unknown/],
    ['inconsistent counts', poscar.replace('1 1\nDirect', '2\nDirect'), /one atom count/],
    ['fractional count', poscar.replace('1 1\nDirect', '1.5 1\nDirect'), /integers/],
    ['too many atoms', poscar.replace('1 1\nDirect', '2000 1\nDirect'), /1999/],
    ['missing coordinates', poscar.replace('-.25 1 .5', ''), /incomplete/],
    ['bad numeric coordinate', poscar.replace('.25 .5 .75', '1foo .5 .75'), /finite number/],
    ['bad mode', poscar.replace('Direct', 'Fractional'), /coordinate mode/],
    ['bad flags', poscar.replace('Direct', 'Selective dynamics\nDirect'), /incomplete/],
  ])('rejects %s', (_label, source, message) => {
    expect(() => parseCrystal(source, 'poscar')).toThrow(message);
  });
});

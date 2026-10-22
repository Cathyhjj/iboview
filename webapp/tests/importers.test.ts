import { describe, expect, it } from 'vitest';
import { formulaFor, parseCube, parseXYZ } from '../src/lib/importers';

const water = '3\nWater\nO 0 0 0\nH 0.757 0.586 0\nH -0.757 0.586 0\n';
const cubeLines = [
  'A scalar field', 'Exported test fixture', '1 0 0 0',
  '2 1 0 0', '2 0 1 0', '2 0 0 1', '6 6 1 2 3',
  '-0.2 -0.1 0 0.1 0.2 0.3 0.4 0.5',
];
function cubeWith(line: number, replacement: string): string {
  return cubeLines.map((value, index) => index === line ? replacement : value).join('\n');
}

describe('XYZ import', () => {
  it('parses a single frame and creates a canonical XYZ and Hill formula', () => {
    const parsed = parseXYZ(water);
    expect(parsed.atoms).toHaveLength(3);
    expect(parsed.atoms[1]).toEqual({ element: 'H', x: 0.757, y: 0.586, z: 0 });
    expect(formulaFor(parsed.atoms)).toBe('H2O');
    expect(parseXYZ(parsed.xyz).atoms).toEqual(parsed.atoms);
  });

  it('accepts blank comments, BOM, CRLF, case-insensitive elements, and D exponents', () => {
    const result = parseXYZ('\uFEFF1\r\n\r\ncl 1.5D+0 -.2d+1 0\r\n');
    expect(result.atoms).toEqual([{ element: 'Cl', x: 1.5, y: -2, z: 0 }]);
  });

  it.each([
    ['count', '1.5\nComment\nH 0 0 0', /integer/],
    ['unknown element', '1\nComment\nXx 0 0 0', /unknown element/],
    ['partial number', '1\nComment\nH 1abc 0 0', /finite number/],
    ['nonfinite coordinate', '1\nComment\nH NaN 0 0', /finite number/],
    ['overflow coordinate', '1\nComment\nH 1e999 0 0', /finite number/],
    ['unreasonable coordinate', '1\nComment\nH 10001 0 0', /10,000/],
    ['missing atom', '2\nComment\nH 0 0 0', /incomplete/],
    ['missing comment', '1\nH 0 0 0\n', /expected element/],
    ['second frame', water + water, /one XYZ frame/],
    ['empty structure', '0\nComment\n', /1–1999/],
    ['oversized structure', '2000\nComment\n', /1–1999/],
  ])('rejects %s', (_name, input, error) => {
    expect(() => parseXYZ(input)).toThrow(error);
  });

  it('uses carbon and hydrogen first only when carbon is present', () => {
    const atoms = parseXYZ('5\n\nO 0 0 0\nC 0 1 0\nH 1 0 0\nBr 2 0 0\nH 0 0 1').atoms;
    expect(formulaFor(atoms)).toBe('CH2BrO');
    expect(formulaFor(parseXYZ('2\n\nNa 0 0 0\nCl 1 0 0').atoms)).toBe('ClNa');
    expect(formulaFor([])).toBe('');
  });
});

describe('Cube import', () => {
  it('keeps field values and converts Bohr atom positions to angstroms', () => {
    const parsed = parseCube(cubeLines.join('\n'));
    expect(parsed.dimensions).toEqual([2, 2, 2]);
    expect(parsed.range).toEqual([-0.2, 0.5]);
    expect(parsed.atoms[0]).toEqual({ element: 'C', x: 0.52917721092, y: 2 * 0.52917721092, z: 3 * 0.52917721092 });
    expect(parsed.cube.split('\n')[2]).toBe('1 0 0 0');
    expect(parseCube(parsed.cube)).toEqual(parsed);
  });

  it('canonicalizes angstrom origins, axes, and atoms to positive-count Bohr', () => {
    const source = [
      'Angstrom fixture', '', '1 0.52917721092 1.05835442184 1.58753163276',
      '-2 0.52917721092 0 0', '-2 0 0.52917721092 0', '-2 0 0 0.52917721092',
      '8 8 1.05835442184 1.58753163276 2.11670884368', '1 2 3 4 5 6 7 8',
    ].join('\n');
    const parsed = parseCube(source);
    expect(parsed.atoms[0]).toEqual({ element: 'O', x: 1.05835442184, y: 1.58753163276, z: 2.11670884368 });
    const canonical = parsed.cube.split('\n');
    canonical[2].split(' ').slice(1).map(Number).forEach((value, index) => expect(value).toBeCloseTo(index + 1, 12));
    expect(canonical[3]).toBe('2 1 0 0');
    canonical[6].split(' ').slice(2).map(Number).forEach((value, index) => expect(value).toBeCloseTo(index + 2, 12));
    expect(parseCube(parsed.cube).atoms[0].z).toBeCloseTo(parsed.atoms[0].z, 12);
    expect(parsed.range).toEqual([1, 8]);
  });

  it('preserves signs and amplitudes with Fortran D exponent syntax', () => {
    const parsed = parseCube(cubeWith(7, '-2.5D-1 -1.0d-1 0 1E-1 2E-1 3E-1 4E-1 5E-1'));
    expect(parsed.range).toEqual([-0.25, 0.5]);
    expect(parsed.cube).toContain('-2.5E-1 -1.0E-1');
    expect(parsed.cube.endsWith('5E-1')).toBe(true);
  });

  it('accepts a single orbital identifier and removes its metadata from canonical data', () => {
    const source = cubeLines.map((line, index) => index === 2 ? '-1 0 0 0' : line);
    source.splice(7, 0, '1 17');
    const parsed = parseCube(source.join('\n'));
    expect(parsed.range).toEqual([-0.2, 0.5]);
    expect(parsed.cube.split('\n')[2]).toBe('1 0 0 0');
    expect(parseCube(parsed.cube).range).toEqual(parsed.range);
  });

  it('accepts nonorthogonal grids with a finite nonzero determinant', () => {
    const parsed = parseCube(cubeWith(3, '2 1 0.5 0'));
    expect(parsed.cube.split('\n')[3]).toBe('2 1 0.5 0');
  });

  it.each([
    ['fractional atom count', 2, '1.5 0 0 0', /integer/],
    ['fractional grid count', 3, '2.5 1 0 0', /integer/],
    ['zero grid count', 3, '0 1 0 0', /nonzero/],
    ['mixed grid units', 3, '-2 1 0 0', /mix unit signs/],
    ['zero grid vector', 3, '2 0 0 0', /span three dimensions/],
    ['dependent grid vectors', 3, '2 0 1 0', /span three dimensions/],
    ['nonfinite origin', 2, '1 Infinity 0 0', /finite number/],
    ['nonfinite grid', 3, '2 1 NaN 0', /finite number/],
    ['oversized grid', 3, '1250000 1 0 0', /fewer than 5,000,000/],
    ['unreasonable grid extent', 3, '2 1000000 0 0', /10,000/],
    ['ghost atom', 6, '0 0 0 0 0', /Ghost atoms/],
    ['fractional atomic number', 6, '6.5 6 0 0 0', /integer/],
    ['nonfinite charge', 6, '6 NaN 0 0 0', /finite number/],
    ['truncated field', 7, '1 2 3', /expected 8 values, found 3/],
    ['excess field', 7, '1 2 3 4 5 6 7 8 9', /expected 8 values, found 9/],
    ['nonfinite field', 7, '1 2 3 4 5 6 7 Infinity', /finite number/],
    ['float32 overflow', 7, '1 2 3 4 5 6 7 1e100', /numeric range/],
    ['multi-field header', 2, '1 0 0 0 2', /Multi-field/],
  ])('rejects %s', (_name, line, replacement, error) => {
    expect(() => parseCube(cubeWith(line, replacement))).toThrow(error);
  });

  it('rejects multi-orbital files instead of interpreting interleaved fields as one orbital', () => {
    const source = cubeLines.map((line, index) => index === 2 ? '-1 0 0 0' : line);
    source.splice(7, 0, '2 17 18');
    expect(() => parseCube(source.join('\n'))).toThrow(/Multi-orbital/);
  });
});

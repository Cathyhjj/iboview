import { parseXYZ, type ParsedStructure } from './importers';

export interface TrajectoryFrame extends ParsedStructure {
  comment: string;
  energy?: { value: number; unit: string };
}
export interface Trajectory { source: string; frames: TrajectoryFrame[] }
const LIMIT_FRAMES = 1000;
const LIMIT_ATOMS = 200_000;

function energyFromComment(comment: string): TrajectoryFrame['energy'] {
  const number = '([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eEdD][+-]?\\d+)?)';
  const match = comment.match(new RegExp('(?:^|\\s)(?:energy|E)\\s*=\\s*' + number + '\\s*(eV|Hartree|Eh|Ha|kJ/mol|kcal/mol)(?=\\s|$|[,;])', 'i'))
    ?? comment.match(new RegExp('(?:^|\\s)energy_(eV|Hartree|Eh|Ha)\\s*=\\s*' + number + '(?=\\s|$|[,;])', 'i'))?.map((part, i, all) => i === 1 ? all[2] : i === 2 ? all[1] : part);
  if (!match) return;
  const value = Number(match[1].replace(/[dD]/, 'e'));
  if (!Number.isFinite(value)) throw new Error('Trajectory energy must be finite.');
  const unit = /^(hartree|eh|ha)$/i.test(match[2]) ? 'Hartree' : /^ev$/i.test(match[2]) ? 'eV' : match[2].toLowerCase();
  return { value, unit };
}

/** Atom identity is the row index, so every frame must retain the element order. */
export function parseXYZTrajectory(source: string): Trajectory {
  if (new TextEncoder().encode(source).byteLength > 35 * 1024 * 1024) throw new Error('XYZ trajectories must be 35 MB or smaller.');
  const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const frames: TrajectoryFrame[] = [];
  let cursor = 0, records = 0;
  while (cursor < lines.length) {
    if (!lines[cursor].trim()) { cursor++; continue; }
    if (!/^\s*\d+\s*$/.test(lines[cursor])) throw new Error(`Frame ${frames.length + 1}: expected an XYZ atom count.`);
    const count = Number(lines[cursor]);
    if (!count || count >= 2000 || !Number.isSafeInteger(count)) throw new Error('Each trajectory frame must contain 1–1999 atoms.');
    records += count;
    if (records > LIMIT_ATOMS || frames.length >= LIMIT_FRAMES) throw new Error('Use at most 1000 frames and 200,000 total atom records.');
    if (cursor + count + 2 > lines.length) throw new Error(`Frame ${frames.length + 1} is incomplete.`);
    const comment = lines[cursor + 1];
    const structure = parseXYZ(lines.slice(cursor, cursor + count + 2).join('\n'));
    if (frames.length && (count !== frames[0].atoms.length || structure.atoms.some((atom, i) => atom.element !== frames[0].atoms[i].element)))
      throw new Error(`Frame ${frames.length + 1}: keep the same atom count and element order in every frame.`);
    frames.push({ ...structure, comment, energy: energyFromComment(comment) });
    cursor += count + 2;
  }
  if (!frames.length) throw new Error('The XYZ file contains no frames.');
  return { source, frames };
}

export function trajectoryEnergy(frames: TrajectoryFrame[]): { unit: string; values: (number | undefined)[] } | undefined {
  const units = new Set(frames.flatMap(frame => frame.energy ? [frame.energy.unit] : []));
  if (units.size !== 1) return;
  const energies = frames.flatMap(frame => frame.energy ? [frame.energy.value] : []);
  const minimum = Math.min(...energies);
  return { unit: [...units][0], values: frames.map(frame => frame.energy ? frame.energy.value - minimum : undefined) };
}

export const TRAJECTORY_EXAMPLE = Array.from({ length: 21 }, (_, i) => {
  const angle = (i / 20 * 100 + 60) * Math.PI / 180;
  const x = .96 * Math.sin(angle / 2), y = .96 * Math.cos(angle / 2);
  return `3\nIllustrative water bending · frame ${i + 1} (geometry demonstration; no calculated energies)\nO 0 0 0\nH ${x} ${y} 0\nH ${-x} ${y} 0\n`;
}).join('');

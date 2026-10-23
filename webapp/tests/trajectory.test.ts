import { describe, expect, it } from 'vitest';
import { parseXYZTrajectory, trajectoryEnergy, TRAJECTORY_EXAMPLE } from '../src/lib/trajectory';
import { parseXYZ } from '../src/lib/importers';
import { serializeProject, parseProject, type ProjectSnapshot } from '../src/lib/project';
import { DEFAULT_MOLECULE_APPEARANCE } from '../src/lib/molecule-appearance';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/lib/display-preferences';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors } from '../src/lib/orbital-colors';
const defaultMoleculeSettings = () => ({ colors: DEFAULT_ORBITAL_COLORS, settings: {
  ...DEFAULT_MOLECULE_APPEARANCE, ...DEFAULT_DISPLAY_PREFERENCES, ...orbitalPhaseColors(DEFAULT_ORBITAL_COLORS),
  isovalue: .045, surface: true, spinning: false,
} });
const frame=(comment='',x=1)=>`2\n${comment}\nC 0 0 0\nO ${x} 0 0\n`;
const camera={rotation:[0,0,0,1] as [number,number,number,number],center:[0,0,0] as [number,number,number],pan:[0,0] as [number,number],halfHeight:3,fittedHalfHeight:3,cameraDistance:50};
describe('XYZ trajectories',()=>{
  it('preserves blank comments, CRLF, atom indices and coordinates',()=>{
    const parsed=parseXYZTrajectory((frame()+frame('second',2)).replace(/\n/g,'\r\n'));
    expect(parsed.frames).toHaveLength(2);expect(parsed.frames[0].comment).toBe('');expect(parsed.frames[1].atoms[1].x).toBe(2);
    expect(()=>parseXYZ(parsed.source)).toThrow(/one XYZ frame/);
  });
  it('rejects changed element order, counts and incomplete final frames',()=>{
    expect(()=>parseXYZTrajectory(frame()+frame().replace('C 0','N 0'))).toThrow(/element order/);
    expect(()=>parseXYZTrajectory(frame()+'1\n\nH 0 0 0\n')).toThrow(/same atom count/);
    expect(()=>parseXYZTrajectory(frame()+'2\nlast\nC 0 0 0\n')).toThrow();
    expect(()=>parseXYZTrajectory(frame()+'garbage')).toThrow(/atom count/);
  });
  it('requires explicit units and preserves missing energy gaps',()=>{
    const parsed=parseXYZTrajectory(frame('energy=-2 Hartree')+frame('E=-1.5 Eh')+frame('energy=-12')+frame('energy_Hartree=-1D0'));
    expect(trajectoryEnergy(parsed.frames)).toEqual({unit:'Hartree',values:[0,.5,undefined,1]});
  });
  it('does not mix incompatible energy units in a curve',()=>{
    const parsed=parseXYZTrajectory(frame('energy=-2 eV')+frame('energy=-1 Hartree'));
    expect(trajectoryEnergy(parsed.frames)).toBeUndefined();
  });
  it('caps trajectory work and supplies an honestly labeled geometry-only example',()=>{
    expect(()=>parseXYZTrajectory(frame().repeat(1001))).toThrow(/1000 frames/);
    const example=parseXYZTrajectory(TRAJECTORY_EXAMPLE);
    expect(example.frames).toHaveLength(21);expect(trajectoryEnergy(example.frames)).toBeUndefined();
  });
  it('round-trips all frames, current index and named cameras through a project',()=>{
    const trajectory=parseXYZTrajectory(frame('energy=-2 eV')+frame('energy=-1 eV',2));
    const defaults=defaultMoleculeSettings();
    const project:ProjectSnapshot={scene:{key:'trajectory',name:'path',fileName:'path.xyz',kind:'xyz',formula:'CO',structure:trajectory.frames[0],trajectory,trajectoryFrame:1},...defaults,camera,theme:'light',namedViews:[{name:'Side',camera}]};
    const loaded=parseProject(serializeProject(project));
    expect(loaded.scene.trajectoryFrame).toBe(1);expect(loaded.scene.trajectory?.frames[1].atoms[1].x).toBe(2);expect(loaded.namedViews).toEqual(project.namedViews);
    const invalid=JSON.parse(serializeProject(project));invalid.scene.trajectoryFrame=.5;
    expect(()=>parseProject(JSON.stringify(invalid))).toThrow(/frame index/);
    invalid.scene.trajectoryFrame=99;expect(()=>parseProject(JSON.stringify(invalid))).toThrow(/trajectory frame/);
  });
});

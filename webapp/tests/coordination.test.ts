import { describe, expect, it } from 'vitest';
import { analyzeCoordination, coordinationCSV, coordinationXYZ } from '../src/lib/coordination';
import type { CrystalData } from '../src/lib/crystal';
import { parseXYZ } from '../src/lib/importers';
const atom=(x=0,y=0,z=0,element='Fe')=>({element,x,y,z});
const simple:CrystalData={cell:[[1,0,0],[0,1,0],[0,0,1]],atoms:[atom()],source:'',format:'poscar'};
describe('local coordination',()=>{
  it('includes six periodic first neighbors on the exact cutoff boundary',()=>{
    const result=analyzeCoordination([atom()],0,1,.01,simple);
    expect(result.neighbors).toHaveLength(6);expect(result.shells).toEqual([{id:0,element:'Fe',count:6,min:1,max:1,mean:1}]);
    expect(result.neighbors.every(n=>n.site===0)).toBe(true);
  });
  it('is independent of the displayed supercell and center replica',()=>{
    const result=analyzeCoordination([atom(5,-3,2)],0,1,.01,simple);
    expect(result.neighbors.map(n=>n.distance)).toEqual([1,1,1,1,1,1]);
    expect(result.neighbors.some(n=>n.image[0]===6)).toBe(true);
  });
  it('handles triclinic cancellation requiring images beyond ±1',()=>{
    const crystal={...simple,cell:[[1,0,0],[3,.5,0],[0,0,4]] as CrystalData['cell']};
    const result=analyzeCoordination([atom()],0,.51,.01,crystal);
    expect(result.neighbors).toHaveLength(2);
    expect(result.neighbors.map(n=>n.distance)).toEqual([.5,.5]);
    expect(result.neighbors.some(n=>Math.abs(n.image[0])===3)).toBe(true);
  });
  it('separates species and bounds shell span instead of chaining adjacent gaps',()=>{
    const result=analyzeCoordination([atom(),atom(1,0,0,'O'),atom(1.08,0,0,'O'),atom(1.16,0,0,'O'),atom(1.01,0,0,'N')],0,2,.1);
    expect(result.shells.map(s=>[s.element,s.count])).toEqual([['O',2],['N',1],['O',1]]);
    expect(result.shells.every(s=>s.max-s.min<=.1+1e-9)).toBe(true);
  });
  it('filters neighbors by element without removing the absorber from exported clusters',()=>{
    const result=analyzeCoordination([atom(10),atom(12,0,0,'O'),atom(9,0,0,'N')],0,3,.1,undefined,'O');
    expect(result.neighbors).toHaveLength(1);
    expect(parseXYZ(coordinationXYZ(result,'test')).atoms).toEqual([atom(),atom(2,0,0,'O')]);
    expect(coordinationCSV(result)).toContain('O,2,0,0,0,2.00000000,1');
  });
  it('fails explicitly rather than truncating excessive periodic work',()=>{
    const crystal={...simple,cell:[[.001,0,0],[0,.001,0],[0,0,.001]] as CrystalData['cell']};
    expect(()=>analyzeCoordination([atom()],0,1,.1,crystal)).toThrow(/too many periodic/);
    expect(()=>analyzeCoordination([atom()],0,NaN,.1)).toThrow(/cutoff/);
  });
});

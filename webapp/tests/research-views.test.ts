import { describe, expect, it } from 'vitest';
import { linkedCamera, namedCamera, normalizeNamedViews, atomCenter } from '../src/lib/research-views';
import { zipFiles } from '../src/lib/zip';
const camera={rotation:[0,0,0,1] as [number,number,number,number],center:[0,0,0] as [number,number,number],pan:[1,2] as [number,number],halfHeight:5,fittedHalfHeight:5,cameraDistance:50};
describe('research view state',()=>{
  it('links absolute scale and orientation without moving another structure pivot',()=>{
    const target={...camera,center:[20,30,40] as [number,number,number],fittedHalfHeight:8,cameraDistance:100};
    const linked=linkedCamera(camera,target);
    expect(linked.center).toEqual(target.center);expect(linked.pan).toEqual([1,2]);expect(linked.halfHeight).toBe(5);expect(linked.fittedHalfHeight).toBe(8);expect(linked.cameraDistance).toBe(100);
    expect(camera.center).toEqual([0,0,0]);
  });
  it('rejects invalid named views and deduplicates names',()=>{
    expect(normalizeNamedViews([{name:'Side',camera},{name:'Side',camera},{name:'bad',camera:{}}])).toEqual([{name:'Side',camera}]);
  });
  it('uses a structure pivot independent of orbital extent',()=>{
    expect(atomCenter([{element:'C',x:10,y:0,z:1},{element:'O',x:12,y:0,z:3}])).toEqual([11,0,2]);
  });
  it('preserves a named close-up offset on its source and translated structures',()=>{
    const view={name:'close-up',camera:{...camera,center:[3,4,5] as [number,number,number]},referenceCenter:[1,2,3] as [number,number,number]};
    expect(namedCamera(view,camera,[1,2,3]).center).toEqual([3,4,5]);
    expect(namedCamera(view,camera,[11,12,13]).center).toEqual([13,14,15]);
  });
  it('writes valid ZIP offsets, UTF-8 names, sizes and a known CRC32',async()=>{
    const bytes=new Uint8Array(await zipFiles([{name:'π.txt',bytes:new TextEncoder().encode('123456789')}]).arrayBuffer());
    const view=new DataView(bytes.buffer),nameLength=new TextEncoder().encode('π.txt').length,central=30+nameLength+9;
    expect(view.getUint32(0,true)).toBe(0x04034b50);expect(view.getUint32(14,true)).toBe(0xcbf43926);
    expect(view.getUint32(central,true)).toBe(0x02014b50);expect(view.getUint32(bytes.length-6,true)).toBe(central);
    expect(new TextDecoder().decode(bytes.slice(30,30+nameLength))).toBe('π.txt');
  });
});

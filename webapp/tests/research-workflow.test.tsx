// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComparisonStudio, type ResearchView } from '../src/components/ComparisonStudio';
import { TrajectoryControls } from '../src/components/TrajectoryControls';
import { DEFAULT_MOLECULE_APPEARANCE } from '../src/lib/molecule-appearance';
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/lib/display-preferences';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors } from '../src/lib/orbital-colors';
const defaultMoleculeSettings = () => ({ colors: DEFAULT_ORBITAL_COLORS, settings: {
  ...DEFAULT_MOLECULE_APPEARANCE, ...DEFAULT_DISPLAY_PREFERENCES, ...orbitalPhaseColors(DEFAULT_ORBITAL_COLORS),
  isovalue: .045, surface: true, spinning: false,
} });
import { normalizeWorkspace } from '../src/lib/workspace-state';
import { parseXYZTrajectory } from '../src/lib/trajectory';
import type { CameraState } from '../src/lib/camera-state';

const engines=vi.hoisted(()=>[] as {camera:CameraState;listener?:()=>void}[]);
vi.mock('../src/render/NativeIboRenderer',()=>({NativeIboRenderer:class {
  camera:CameraState={rotation:[0,0,0,1],center:[0,0,0],pan:[0,0],halfHeight:4,fittedHalfHeight:4,cameraDistance:50};
  listener?:()=>void;
  constructor(){engines.push(this);}
  setCameraChangeListener(listener:()=>void){this.listener=listener;}
  getCameraState(){return structuredClone(this.camera);}
  restoreCameraState(camera:CameraState){this.camera=structuredClone(camera);return true;}
  orient(){this.listener?.();}
  fit(){} resize(){} render(){} destroy(){} setTheme(){} setBackground(){} setLightIntensity(){} setDepthOpacity(){}
  setMeshes(){} setAuxiliaryMesh(){} setMaterial(){} setSpinning(){} setInteractionMode(){} setOrbitalColors(){}
}}));
let root:Root,container:HTMLDivElement;
beforeEach(()=>{
  vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  vi.spyOn(HTMLDialogElement.prototype,'showModal').mockImplementation(function(this:HTMLDialogElement){this.open=true;});
  vi.spyOn(HTMLDialogElement.prototype,'close').mockImplementation(function(this:HTMLDialogElement){this.open=false;this.dispatchEvent(new Event('close'));});
  engines.length=0;container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
async function click(text:string){
  const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text);
  expect(button,text).toBeDefined();await act(async()=>button!.click());
}
async function ready(){await act(async()=>vi.advanceTimersByTime(60));}
function view():ResearchView {
  return {id:'source',title:'Structure',scene:{key:'source',kind:'xyz',name:'Structure',formula:'H',fileName:'h.xyz',structure:{atoms:[{element:'H',x:0,y:0,z:0}],xyz:'1\n\nH 0 0 0\n'}},
    settings:defaultMoleculeSettings().settings,workspace:normalizeWorkspace(null),theme:'light',camera:{rotation:[0,0,0,1],center:[0,0,0],pan:[0,0],halfHeight:4,fittedHalfHeight:4,cameraDistance:50}};
}
describe('research workflow interactions',()=>{
  it('keeps bidirectional camera linking after ready rerenders and dialog reopen',async()=>{
    await act(async()=>root.render(<ComparisonStudio capture={view} namedViews={[]} renderQuality="fast" orbitalOptions={[]} loadOrbital={async()=>view().scene}/>));
    await click('Compare & batch export');await ready();await click('Add current view');await ready();
    expect(container.querySelectorAll('[data-render-state="ready"]')).toHaveLength(2);
    expect(engines).toHaveLength(2);
    engines[0].camera.rotation=[0,.6,0,.8];
    await act(async()=>engines[0].listener?.());
    expect(engines[1].camera.rotation).toEqual([0,.6,0,.8]);
    engines[1].camera.halfHeight=2;
    await act(async()=>engines[1].listener?.());
    expect(engines[0].camera.halfHeight).toBe(2);
    await click('Close');await click('Compare & batch export');await ready();
    expect(engines.at(-1)?.camera.rotation).toEqual([0,.6,0,.8]);
    expect(engines.at(-1)?.camera.halfHeight).toBe(2);
  });
  it('waits for rendering before playing a frame and cleans up its timer',async()=>{
    const trajectory=parseXYZTrajectory('1\nfirst\nH 0 0 0\n1\nsecond\nH 1 0 0\n'),onFrame=vi.fn();
    await act(async()=>root.render(<TrajectoryControls trajectory={trajectory} index={0} ready={false} onFrame={onFrame}/>));
    await click('Play trajectory');await act(async()=>vi.advanceTimersByTime(1000));expect(onFrame).not.toHaveBeenCalled();
    await act(async()=>root.render(<TrajectoryControls trajectory={trajectory} index={0} ready onFrame={onFrame}/>));
    await act(async()=>vi.advanceTimersByTime(200));expect(onFrame).toHaveBeenCalledWith(1);
    await click('Pause trajectory');onFrame.mockClear();await act(async()=>vi.advanceTimersByTime(1000));expect(onFrame).not.toHaveBeenCalled();
  });
  it('links keyboard selection on the energy curve to the trajectory frame',async()=>{
    const trajectory=parseXYZTrajectory('1\nenergy=-2 eV\nH 0 0 0\n1\nenergy=-1 eV\nH 1 0 0\n'),onFrame=vi.fn();
    await act(async()=>root.render(<TrajectoryControls trajectory={trajectory} index={0} ready onFrame={onFrame}/>));
    const plot=container.querySelector('[role=slider]')!;
    await act(async()=>plot.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
    expect(onFrame).toHaveBeenCalledWith(1);expect(plot.getAttribute('aria-valuenow')).toBe('1');
  });
});

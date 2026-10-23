import { useCallback, useEffect, useRef, useState } from 'react';
import { MoleculeViewer, type ViewerHandle } from './NativeMoleculeViewer';
import type { CameraState } from '../lib/camera-state';
import type { DisplaySettings, Scene } from '../types';
import type { WorkspaceState } from '../lib/workspace-state';
import type { RenderQuality } from '../lib/render-quality';
import { atomCenter, downloadBlob, linkedCamera, namedCamera, safeFilename, type NamedView } from '../lib/research-views';
import { zipFiles } from '../lib/zip';

export interface ResearchView {
  id:string; title:string; scene:Scene; settings:DisplaySettings; workspace:WorkspaceState;
  camera:CameraState; theme:'light'|'dark';
}
interface Props { capture:()=>ResearchView|undefined; namedViews:NamedView[]; renderQuality:RenderQuality; orbitalOptions:{id:string;label:string}[]; loadOrbital:(id:string)=>Promise<Scene> }
type BatchJob={id:number;view:ResearchView;camera:CameraState};

function ComparePane({ view, settings, renderQuality, register, onCamera, onReady, onRemove }: {
  view:ResearchView; settings:DisplaySettings; renderQuality:RenderQuality;
  register:(id:string,handle:ViewerHandle|null)=>void; onCamera:(id:string,camera:CameraState)=>void;
  onReady:(id:string)=>void; onRemove:()=>void;
}) {
  const [status,setStatus]=useState('loading'),[error,setError]=useState('');
  const current=useRef({view,onReady,onCamera});current.current={view,onReady,onCamera};
  const handleStatus=useCallback((state:string,message?:string)=>{setStatus(state);setError(state==='error' ? message ?? 'Unable to render.' : '');if(state==='ready')current.current.onReady(current.current.view.id);},[]);
  const handleCamera=useCallback((camera:CameraState)=>current.current.onCamera(current.current.view.id,camera),[]);
  const handleRef=useCallback((handle:ViewerHandle|null)=>register(view.id,handle),[register,view.id]);
  return <section className="compare-pane" data-render-state={status}><header><strong>{view.title}</strong><button onClick={onRemove} aria-label={`Remove ${view.title}`}>×</button></header><div className="compare-canvas"><MoleculeViewer ref={handleRef} scene={view.scene} settings={settings} workspace={view.workspace} initialCamera={view.camera} persistCamera={false} theme={view.theme} renderQuality={renderQuality} onStatus={handleStatus} onCameraChange={handleCamera}/>{status!=='ready' && <span className="compare-status" role={error ? 'alert' : 'status'}>{error || 'Preparing view…'}</span>}</div></section>;
}

function BatchCanvas({ job, quality, onResult, transparent, width }: {job:BatchJob;quality:RenderQuality;transparent:boolean;width:number;onResult:(id:number,data?:string,error?:string)=>void}) {
  const viewer=useRef<ViewerHandle>(null),current=useRef({job,onResult,transparent,width});current.current={job,onResult,transparent,width};
  const finished=useRef(-1);
  const status=useCallback((state:string,message?:string)=>{
    const {job,onResult,transparent,width}=current.current;
    if (state==='loading' || finished.current===job.id) return;
    finished.current=job.id;
    if(state==='error'){onResult(job.id,undefined,message);return;}
    const base=512*Math.min(2,window.devicePixelRatio||1);
    const scale:1|2|4=width<=base ? 1 : width<=base*2 ? 2 : 4;
    try {onResult(job.id,viewer.current?.exportPNG({scale,transparentBackground:transparent,cropTransparent:false}));}
    catch(error){onResult(job.id,undefined,error instanceof Error ? error.message : 'PNG export failed.');}
  },[]);
  return <div className="batch-canvas" aria-hidden="true"><MoleculeViewer ref={viewer} scene={job.view.scene} settings={job.view.settings} workspace={job.view.workspace} initialCamera={job.camera} theme={job.view.theme} renderQuality={quality} persistCamera={false} onStatus={status}/></div>;
}

async function labeledPNG(data:string,title:string,width:number,transparent:boolean):Promise<HTMLCanvasElement> {
  const image=new Image();image.src=data;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=width*3/4+48;
  const context=canvas.getContext('2d');if(!context)throw new Error('Unable to prepare export image.');
  if(!transparent){context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);}
  context.drawImage(image,0,48,width,width*3/4);
  context.fillStyle='#ffffff';context.fillRect(0,0,width,48);context.fillStyle='#30213f';context.font='500 20px sans-serif';
  context.fillText(title,18,31,width-36);return canvas;
}
const canvasBytes=(canvas:HTMLCanvasElement)=>new Promise<Uint8Array>((resolve,reject)=>canvas.toBlob(blob=>{
  if(!blob){reject(new Error('PNG encoding failed.'));return;}void blob.arrayBuffer().then(buffer=>resolve(new Uint8Array(buffer)),reject);
},'image/png'));

export function ComparisonStudio({capture,namedViews,renderQuality,orbitalOptions,loadOrbital}:Props) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [open,setOpen]=useState(false),[views,setViews]=useState<ResearchView[]>([]),[linked,setLinked]=useState(true),[unified,setUnified]=useState(false);
  const [isovalue,setIsovalue]=useState(.045),[orbitalId,setOrbitalId]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [working,setWorking]=useState(false),[progress,setProgress]=useState(''),[job,setJob]=useState<BatchJob>();
  const [panelPreview,setPanelPreview]=useState('');
  const [source,setSource]=useState<'pins'|'orbitals'>('pins'),[useViews,setUseViews]=useState(false),[width,setWidth]=useState(1024),[transparent,setTransparent]=useState(true);
  const handles=useRef(new Map<string,ViewerHandle>()),ready=useRef(new Set<string>()),serial=useRef(0),cancel=useRef(false);
  const cameras=useRef(new Map<string,CameraState>());
  const pending=useRef<{id:number;resolve:(data:string)=>void;reject:(error:Error)=>void;timer:number}|undefined>(undefined);
  const state=useRef({views,linked,unified,isovalue});state.current={views,linked,unified,isovalue};
  const register=useCallback((id:string,handle:ViewerHandle|null)=>{if(handle)handles.current.set(id,handle);else {handles.current.delete(id);ready.current.delete(id);}},[]);
  const sync=useCallback((id:string,camera:CameraState)=>{
    cameras.current.set(id,camera);
    if(!state.current.linked)return;
    let common=camera;
    for(const [key,handle] of handles.current)if(ready.current.has(key)){const target=handle.getCameraState();if(target)common=linkedCamera(common,target);}
    for(const [key,handle] of handles.current)if(ready.current.has(key)){
      const target=handle.getCameraState();if(target){const next={...common,center:target.center};handle.restoreCameraState(next);cameras.current.set(key,next);}
    }
  },[]);
  const paneReady=useCallback((id:string)=>{
    const firstReady=!ready.current.has(id);
    ready.current.add(id);
    const view=state.current.views.find(v=>v.id===id),handle=handles.current.get(id),camera=handle?.getCameraState();
    if(firstReady&&view&&handle&&camera)handle.restoreCameraState(cameras.current.get(id)??{...camera,center:atomCenter(view.scene.structure.atoms)});
    const first=state.current.views.find(v=>ready.current.has(v.id));
    const leader=first&&handles.current.get(first.id)?.getCameraState();
    if(first&&leader){
      if(firstReady)for(const [key,pane]of handles.current)if(ready.current.has(key))leader.halfHeight=Math.max(leader.halfHeight,pane.getCameraState()?.halfHeight??leader.halfHeight);
      sync(first.id,leader);
    }
  },[sync]);
  const batchResult=useCallback((id:number,data?:string,message?:string)=>{
    const operation=pending.current;if(!operation||operation.id!==id)return;
    window.clearTimeout(operation.timer);pending.current=undefined;
    if(data)operation.resolve(data);else operation.reject(new Error(message||'The export view is not ready.'));
  },[]);
  function stop(){cancel.current=true;if(pending.current){window.clearTimeout(pending.current.timer);pending.current.reject(new Error('Export canceled.'));pending.current=undefined;}setJob(undefined);}
  useEffect(()=>()=>{cancel.current=true;if(pending.current){window.clearTimeout(pending.current.timer);pending.current.reject(new Error('Export canceled.'));}},[]);
  function add(view:ResearchView|undefined){
    if(!view){setError('Wait for the current view to finish rendering.');return;}
    if(views.length>=4){setError('Up to four comparison views. Remove one before adding another.');return;}
    const next={...view,id:`pin-${++serial.current}`,settings:{...view.settings,spinning:false},camera:{...view.camera,center:atomCenter(view.scene.structure.atoms)}};
    setViews(previous=>[...previous,next]);setIsovalue(view.settings.isovalue);setError('');setNotice(`Added ${view.title}.`);
  }
  function show(){if(!views.length)add(capture());setOpen(true);dialog.current?.showModal();}
  async function addOrbital(){
    const id=orbitalId||orbitalOptions[0]?.id,base=capture();if(!id||!base)return;
    setWorking(true);setError('');
    try{const scene=await loadOrbital(id);add({...base,scene,title:scene.orbital?.label??scene.name});}
    catch(e){setError(e instanceof Error?e.message:'Unable to load orbital.');}finally{setWorking(false);}
  }
  async function batch(){
    setWorking(true);setError('');setNotice('');setPanelPreview('');cancel.current=false;
    const files:{name:string;bytes:Uint8Array}[]=[],panels:HTMLCanvasElement[]=[],records:unknown[]=[];
    try{
      const count=(source==='orbitals'?orbitalOptions.length:views.length)*(useViews?namedViews.length:1);
      if(count>24)throw new Error('Export at most 24 images at once. Reduce the named views or sources.');
      let sources=views.map(v=>({...v,camera:handles.current.get(v.id)?.getCameraState()??cameras.current.get(v.id)??v.camera}));
      if(source==='orbitals'){
        const base=capture();if(!base||!orbitalOptions.length)throw new Error('Open a demo or saved multi-orbital project first.');
        sources=[];
        for(const orbital of orbitalOptions){if(cancel.current)throw new Error('Export canceled.');setProgress(`Loading ${orbital.label}…`);const scene=await loadOrbital(orbital.id);sources.push({...base,id:orbital.id,scene,title:`${scene.name} · ${orbital.label}`});}
      }
      if(!sources.length)throw new Error('Add at least one view to the comparison.');
      const namedCameras=useViews?namedViews:[];
      if(useViews&&!namedCameras.length)throw new Error('Save a named view in the main workspace first.');
      for(const sourceView of sources)for(const named of namedCameras.length?namedCameras:[undefined]){
        if(cancel.current)throw new Error('Export canceled.');
        const index=panels.length+1,title=`${sourceView.title}${named?` · ${named.name}`:''}`;
        setProgress(`Rendering ${index} / ${count}: ${title}`);
        const id=++serial.current;
        const camera=named ? namedCamera(named,sourceView.camera,atomCenter(sourceView.scene.structure.atoms)) : sourceView.camera;
        const base=unified&&views[0]?views[0].settings:sourceView.settings;
        const settings={...base,isovalue:unified?isovalue:base.isovalue,spinning:false};
        const view={...sourceView,settings,scene:{...sourceView.scene,key:`batch-${id}`}};
        const data=await new Promise<string>((resolve,reject)=>{
          pending.current={id,resolve,reject,timer:window.setTimeout(()=>{pending.current=undefined;reject(new Error('Rendering timed out. Try a lower render quality.'));},60000)};
          setJob({id,view,camera});
        });
        if(cancel.current)throw new Error('Export canceled.');
        const panel=await labeledPNG(data,title,width,transparent);
        const filename=`${String(index).padStart(2,'0')}-${safeFilename(title)}.png`;
        files.push({name:filename,bytes:await canvasBytes(panel)});
        records.push({file:filename,title,source:sourceView.scene.fileName,orbital:sourceView.scene.orbital?.id,isovalue:settings.isovalue,settings,workspace:sourceView.workspace,camera,width:panel.width,height:panel.height});
        const thumbnail=document.createElement('canvas');thumbnail.width=Math.min(width,768);thumbnail.height=Math.round(panel.height/panel.width*thumbnail.width);
        const ctx=thumbnail.getContext('2d');if(!ctx)throw new Error('Unable to prepare panel thumbnail.');ctx.drawImage(panel,0,0,thumbnail.width,thumbnail.height);panels.push(thumbnail);panel.width=1;panel.height=1;
      }
      if(cancel.current)throw new Error('Export canceled.');
      const columns=panels.length===1?1:2,rows=Math.ceil(panels.length/columns),thumbWidth=Math.min(width,768),thumbHeight=Math.round(panels[0].height/panels[0].width*thumbWidth);
      const sheet=document.createElement('canvas');sheet.width=columns*thumbWidth;sheet.height=rows*thumbHeight;
      const ctx=sheet.getContext('2d');if(!ctx)throw new Error('Unable to prepare panel sheet.');
      if(!transparent){ctx.fillStyle='#fff';ctx.fillRect(0,0,sheet.width,sheet.height);}
      panels.forEach((panel,i)=>ctx.drawImage(panel,(i%columns)*thumbWidth,Math.floor(i/columns)*thumbHeight,thumbWidth,thumbHeight));
      files.push({name:'panel-sheet.png',bytes:await canvasBytes(sheet)});
      files.push({name:'views.json',bytes:new TextEncoder().encode(JSON.stringify({format:'iboview-figure-export',version:1,images:records},null,2))});
      downloadBlob(zipFiles(files),'IboView-figures.zip');setPanelPreview(sheet.toDataURL('image/png'));setNotice(`Exported ${panels.length} PNGs, a panel sheet and view settings in one ZIP.`);
    }catch(e){setError(e instanceof Error?e.message:'Batch export failed.');}
    finally{setJob(undefined);setWorking(false);setProgress('');}
  }
  return <>
    <div className="research-row"><button className="tool-button" onClick={()=>add(capture())} disabled={working||views.length>=4}>Pin current ({views.length}/4)</button><button className="tool-button" onClick={show}>Compare & batch export</button></div>
    {notice&&!open&&<p className="research-note" role="status">{notice}</p>}{error&&!open&&<p role="alert">{error}</p>}
    <dialog ref={dialog} className="research-dialog comparison-dialog" onCancel={e=>{if(working)e.preventDefault();}} onClose={()=>{for(const [id,handle]of handles.current){const camera=handle.getCameraState();if(camera)cameras.current.set(id,camera);}stop();setOpen(false);}}>
      <div className="research-heading"><div><h2>Compare & export</h2><p>Pin structures, orbitals or trajectory frames for side-by-side comparison.</p></div><button disabled={working} onClick={()=>dialog.current?.close()}>Close</button></div>
      <div className="research-row"><button disabled={working||views.length>=4} onClick={()=>add(capture())}>Add current view</button>
        {!!orbitalOptions.length&&<><select aria-label="Comparison orbital" value={orbitalId||orbitalOptions[0]?.id} onChange={e=>setOrbitalId(e.target.value)}>{orbitalOptions.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select><button disabled={working||views.length>=4} onClick={()=>void addOrbital()}>Add orbital</button></>}
        <label><input type="checkbox" checked={linked} onChange={e=>{setLinked(e.target.checked);state.current.linked=e.target.checked;const first=views[0],camera=first&&handles.current.get(first.id)?.getCameraState();if(camera)sync(first.id,camera);}}/> Link cameras</label>
        <label><input type="checkbox" checked={unified} disabled={working} onChange={e=>setUnified(e.target.checked)}/> Use first view's appearance</label>
        {unified&&<label>Shared isovalue <input aria-label="Shared isovalue" disabled={working} type="number" min=".000001" step=".005" value={isovalue} onChange={e=>{const value=Number(e.target.value);if(value>0&&Number.isFinite(value))setIsovalue(value);}}/></label>}
      </div>
      <p className="research-note">Linked views share rotation, pan and physical scale with independent structure centers. Coordinates are not automatically aligned. Use shared isovalues only for fields with matching units. Close this window to load another structure, then pin it; pins last for this session.</p>
      {open&&<div className={`comparison-grid ${views.length>2?'four':''}`}>{views.map(view=><ComparePane key={view.id} view={view} settings={{...(unified&&views[0]?views[0].settings:view.settings),isovalue:unified?isovalue:view.settings.isovalue,spinning:false}} renderQuality={renderQuality} register={register} onCamera={sync} onReady={paneReady} onRemove={()=>{if(!working)setViews(v=>v.filter(item=>item.id!==view.id));}}/>)}</div>}
      <section className="batch-settings"><h3>Batch figures</h3><div className="research-row">
        <label>Sources <select aria-label="Batch sources" disabled={working} value={source} onChange={e=>setSource(e.target.value as 'pins'|'orbitals')}><option value="pins">Pinned views</option><option value="orbitals" disabled={!orbitalOptions.length}>All listed orbitals</option></select></label>
        <label>Image width <select disabled={working} value={width} onChange={e=>setWidth(Number(e.target.value))}>{[1024,1536,2048].map(n=><option key={n} value={n}>{n} px</option>)}</select></label>
        <label><input type="checkbox" disabled={working||!namedViews.length} checked={useViews} onChange={e=>setUseViews(e.target.checked)}/> Every named view ({namedViews.length})</label>
        <label><input type="checkbox" disabled={working} checked={transparent} onChange={e=>setTransparent(e.target.checked)}/> Transparent scene</label>
        <button disabled={working} onClick={()=>void batch()}>Export PNGs + panel sheet (ZIP)</button>{working&&<button onClick={stop}>Cancel export</button>}
      </div><p className="research-note">Fixed 4:3 scene area plus a 48 px title band. All images keep equal dimensions; individual cropping is disabled. The ZIP includes full-size PNGs, a compact panel sheet and camera/settings metadata.</p></section>
      {progress&&<p role="status">{progress}</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
      {panelPreview&&<details className="batch-preview" open><summary>Exported panel sheet</summary><img src={panelPreview} alt="Batch figure preview"/></details>}
      {job&&<BatchCanvas job={job} quality={renderQuality} transparent={transparent} width={width} onResult={batchResult}/>}
    </dialog>
  </>;
}

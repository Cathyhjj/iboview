import { useCallback, useMemo, useRef, useState } from 'react';
import { analyzeCoordination, coordinationCSV, coordinationXYZ } from '../lib/coordination';
import { DEFAULT_WORKSPACE, normalizeWorkspace } from '../lib/workspace-state';
import { downloadBlob, safeFilename } from '../lib/research-views';
import { MoleculeViewer } from './NativeMoleculeViewer';
import type { DisplaySettings, Scene } from '../types';
import type { RenderQuality } from '../lib/render-quality';

const SHELL_COLORS=['#9072d4','#38a3a5','#e99542','#d26e95','#648ed1','#a1ac50'];
export function CoordinationTool({ scene:currentScene, settings, selectedAtoms, theme, renderQuality }: {
  scene?:Scene; settings:DisplaySettings; selectedAtoms:number[]; theme:'light'|'dark'; renderQuality:RenderQuality;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [scene,setScene]=useState<Scene>();
  const [open,setOpen]=useState(false), [center,setCenter]=useState(0), [cutoff,setCutoff]=useState(3.5), [tolerance,setTolerance]=useState(.1);
  const [element,setElement]=useState(''), [shell,setShell]=useState<number>(), [renderError,setRenderError]=useState('');
  const onStatus=useCallback((status:string,message?:string)=>setRenderError(status==='error' ? message ?? 'Unable to render cluster.' : ''),[]);
  const analysis=useMemo(()=>{
    if (!open || !scene) return {};
    try { return { result:analyzeCoordination(scene.structure.atoms,center,cutoff,tolerance,scene.crystal,element) }; }
    catch(error) { return { error:error instanceof Error ? error.message : 'Unable to analyze this center.' }; }
  },[open,scene,center,cutoff,tolerance,element]);
  const result=analysis.result;
  const preview=useMemo(()=>{
    if (!result || !scene || result.neighbors.length>=1999) return;
    const atoms=[{ ...result.center,x:0,y:0,z:0 },...result.neighbors.map(n=>n.atom)];
    const workspace=normalizeWorkspace({ ...DEFAULT_WORKSPACE,atomOverrides:Object.fromEntries(result.neighbors.map((n,i)=>[i+1,{color:SHELL_COLORS[n.shell%SHELL_COLORS.length]}])) });
    const cluster:Scene={key:`coordination-${scene.key}-${center}-${cutoff}-${tolerance}-${element}`,name:`${result.center.element} coordination`,fileName:scene.fileName,kind:'xyz',formula:'',structure:{atoms,xyz:coordinationXYZ(result,scene.name)}};
    return { scene:cluster,workspace };
  },[result,scene,center,cutoff,tolerance,element]);
  function exportResult(kind:'xyz'|'csv'|'json') {
    if (!result || !scene) return;
    const text=kind==='xyz' ? coordinationXYZ(result,scene.name) : kind==='csv' ? coordinationCSV(result)
      : JSON.stringify({source:scene.fileName,centerIndex:center+1,cell:scene.crystal?.cell,...result},null,2);
    downloadBlob(new Blob([text],{type:kind==='json' ? 'application/json' : 'text/plain'}),`${safeFilename(scene.name)}-${result.center.element}${center+1}-neighbors.${kind}`);
  }
  return <>
    <button className="tool-button" disabled={!currentScene} onClick={()=>{ setScene(currentScene);setElement('');setCenter(selectedAtoms.at(-1) ?? 0); setShell(undefined); setOpen(true); dialog.current?.showModal(); }}>Local coordination / XAS</button>
    <dialog ref={dialog} className="research-dialog coordination-dialog" onClose={()=>setOpen(false)}>
      <div className="research-heading"><div><h2>Local coordination</h2><p>Neighbors around an absorber · distances in Å</p></div><button onClick={()=>dialog.current?.close()} aria-label="Close coordination">Close</button></div>
      {open && scene && <>
        <div className="research-row">
          <label>Center <select aria-label="Coordination center" value={center} onChange={e=>{setCenter(Number(e.target.value));setShell(undefined);}}>{scene.structure.atoms.map((a,i)=><option key={i} value={i}>{a.element}{i+1}</option>)}</select></label>
          <label>Cutoff (Å) <input aria-label="Coordination cutoff" type="number" min=".1" max="12" step=".1" value={cutoff} onChange={e=>{setCutoff(Number(e.target.value));setShell(undefined);}}/></label>
          <label>Shell tolerance (Å) <input aria-label="Shell tolerance" type="number" min="0" max="1" step=".01" value={tolerance} onChange={e=>{setTolerance(Number(e.target.value));setShell(undefined);}}/></label>
          <label>Neighbors <select aria-label="Neighbor element" value={element} onChange={e=>{setElement(e.target.value);setShell(undefined);}}><option value="">All elements</option>{[...new Set(scene.structure.atoms.map(a=>a.element))].map(e=><option key={e}>{e}</option>)}</select></label>
        </div>
        <p className="research-note">{scene.crystal ? 'Periodic neighbors are included across unit-cell boundaries, independently of displayed supercell repeats.' : 'Finite molecule: only supplied atoms participate.'} Counts use the cutoff above. Shells group each element with maximum distance spread ≤ tolerance; these are structural neighbor counts, not fitted EXAFS coordination numbers.</p>
        {analysis.error && <p role="alert">{analysis.error}</p>}
        {result && <div className="coordination-layout">
          <div><div className="coordination-preview">{preview ? <MoleculeViewer scene={preview.scene} settings={{...settings,spinning:false,surface:false,hydrogens:true}} workspace={preview.workspace} selectedAtoms={shell===undefined ? [0] : result.neighbors.flatMap((n,i)=>n.shell===shell ? [i+1] : [])} theme={theme} renderQuality={renderQuality} persistCamera={false} onStatus={onStatus}/> : <p>Cluster exceeds the 1999-atom preview limit. Exports include every neighbor.</p>}</div>{renderError && <p role="alert">{renderError}</p>}<p className="research-note">Center is at the origin. Shell colors identify distance groups. Select a row to highlight a shell.</p></div>
          <div><strong>{result.neighbors.length} neighbors · {result.shells.length} shells</strong>
            <div className="research-table-scroll"><table><thead><tr><th>Shell</th><th>Element</th><th>Count</th><th>Mean Å</th><th>Range Å</th></tr></thead><tbody>{result.shells.map(s=><tr key={s.id} aria-selected={shell===s.id}><td><button onClick={()=>setShell(shell===s.id ? undefined : s.id)}><i style={{background:SHELL_COLORS[s.id%SHELL_COLORS.length]}}/>{s.id+1}</button></td><td>{s.element}</td><td>{s.count}</td><td>{s.mean.toFixed(4)}</td><td>{s.min.toFixed(3)}–{s.max.toFixed(3)}</td></tr>)}</tbody></table></div>
            <svg className="distance-plot" viewBox="0 0 420 72" role="img" aria-label="Neighbor distance distribution"><title>Neighbor distances from 0 to {cutoff} Å, colored by shell</title><line x1="10" x2="410" y1="50" y2="50" stroke="currentColor"/>{result.neighbors.map((n,i)=><line key={i} x1={10+n.distance/cutoff*400} x2={10+n.distance/cutoff*400} y1="10" y2="48" stroke={SHELL_COLORS[n.shell%SHELL_COLORS.length]} opacity=".6"/>)}<text x="10" y="67">0</text><text x="365" y="67">{cutoff} Å</text></svg>
            <div className="research-row"><button onClick={()=>exportResult('xyz')}>Export cluster XYZ</button><button onClick={()=>exportResult('csv')}>Distances CSV</button><button onClick={()=>exportResult('json')}>Analysis JSON</button></div>
          </div>
        </div>}
      </>}
    </dialog>
  </>;
}

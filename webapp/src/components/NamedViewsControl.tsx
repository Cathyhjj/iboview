import { useState } from 'react';
import type { NamedView } from '../lib/research-views';
import type { CameraState } from '../lib/camera-state';

export function NamedViewsControl({ views, onChange, getCamera, getCenter, onRestore }: {
  views:NamedView[]; onChange:(views:NamedView[])=>void; getCamera:()=>CameraState|undefined; getCenter:()=>CameraState['center']; onRestore:(camera:CameraState)=>void;
}) {
  const [name,setName]=useState(''),[error,setError]=useState('');
  function save() {
    const camera=getCamera(), label=name.trim().slice(0,80);
    if (!camera || !label) {setError('Enter a name after the view is ready.');return;}
    if (views.length>=30 && !views.some(v=>v.name===label)) {setError('Use at most 30 named views per structure.');return;}
    onChange([...views.filter(v=>v.name!==label),{name:label,camera,referenceCenter:getCenter()}]);setError('');setName('');
  }
  return <div className="named-views"><div className="research-row"><input aria-label="View name" placeholder="e.g. Metal center close-up" maxLength={80} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();}}/><button onClick={save}>Save view</button></div>
    {views.map(view=><div className="named-view" key={view.name}><button onClick={()=>onRestore(view.camera)}>{view.name}</button><button aria-label={`Remove view ${view.name}`} onClick={()=>onChange(views.filter(v=>v.name!==view.name))}>×</button></div>)}
    {error && <p role="alert">{error}</p>}<p className="research-note">Views save camera position and scale. Reusing a name updates it. Included in saved projects and batch export.</p>
  </div>;
}

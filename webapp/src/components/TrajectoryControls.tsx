import { useEffect, useState } from 'react';
import { trajectoryEnergy, type Trajectory } from '../lib/trajectory';

export function TrajectoryControls({ trajectory, index, onFrame, ready }: {
  trajectory: Trajectory; index: number; onFrame: (index: number) => void; ready: boolean;
}) {
  const [playing,setPlaying]=useState(false), [fps,setFps]=useState(5), [loop,setLoop]=useState(true);
  useEffect(() => { setPlaying(false); },[trajectory]);
  useEffect(() => {
    if (!playing || !ready) return;
    const timer=window.setTimeout(() => {
      if (index+1 < trajectory.frames.length) onFrame(index+1);
      else if (loop) onFrame(0);
      else setPlaying(false);
    },1000/fps);
    return () => window.clearTimeout(timer);
  },[playing,ready,index,trajectory,fps,loop,onFrame]);
  const energies=trajectoryEnergy(trajectory.frames);
  const maximum=energies ? Math.max(...energies.values.map(v=>v ?? 0),1e-12) : 1;
  const x=(i:number)=>12+i/Math.max(1,trajectory.frames.length-1)*576;
  const y=(v:number)=>70-v/maximum*58;
  const segments: string[]=[];
  if (energies) {
    let segment='';
    energies.values.forEach((value,i)=>{
      if (value === undefined) { if (segment) segments.push(segment); segment=''; }
      else segment+=`${segment ? ' L' : 'M'}${x(i)},${y(value)}`;
    });
    if (segment) segments.push(segment);
  }
  const change=(i:number)=>{ setPlaying(false); onFrame(i); };
  const frame=trajectory.frames[index];
  return <section className="trajectory-controls" aria-label="Trajectory playback">
    <div className="research-row"><strong>Trajectory</strong><span>Frame {index+1} / {trajectory.frames.length}</span>
      <button onClick={()=>change(Math.max(0,index-1))} disabled={!index} aria-label="Previous frame">‹</button>
      <button onClick={()=>setPlaying(p=>!p)} aria-pressed={playing}>{playing ? 'Pause trajectory' : 'Play trajectory'}</button>
      <button onClick={()=>change(Math.min(trajectory.frames.length-1,index+1))} disabled={index===trajectory.frames.length-1} aria-label="Next frame">›</button>
      <label>Speed <select aria-label="Trajectory speed" value={fps} onChange={e=>setFps(Number(e.target.value))}>{[1,2,5,10].map(n=><option key={n} value={n}>{n} fps</option>)}</select></label>
      <label><input type="checkbox" checked={loop} onChange={e=>setLoop(e.target.checked)}/> Loop</label>
    </div>
    <input aria-label="Trajectory frame" type="range" min="0" max={trajectory.frames.length-1} value={index} onChange={e=>change(Number(e.target.value))}/>
    {energies && <svg viewBox="0 0 600 82" className="trajectory-plot" role="slider" tabIndex={0} aria-label={`Energy curve in ${energies.unit}`} aria-valuemin={1} aria-valuemax={trajectory.frames.length} aria-valuenow={index+1}
      onClick={event=>{const box=event.currentTarget.getBoundingClientRect();const fraction=(600*(event.clientX-box.left)/box.width-12)/576;change(Math.max(0,Math.min(trajectory.frames.length-1,Math.round(fraction*(trajectory.frames.length-1)))));}}
      onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();change(event.key==='Home'?0:event.key==='End'?trajectory.frames.length-1:Math.max(0,Math.min(trajectory.frames.length-1,index+(event.key==='ArrowRight'?1:-1))));}}}>
      <title>Energy relative to the lowest supplied value ({energies.unit})</title>
      {segments.map((d,i)=><path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="2"/>)}
      <line x1={x(index)} x2={x(index)} y1="5" y2="75" stroke="currentColor" strokeDasharray="3 3"/>
      {energies.values[index]!==undefined && <circle cx={x(index)} cy={y(energies.values[index]!)} r="4" fill="currentColor"/>}
    </svg>}
    <p>{frame.comment || `Frame ${index+1}`}</p>
    <small>{energies ? `ΔE: ${energies.values[index]?.toPrecision(6) ?? 'unavailable'} ${energies.unit} · relative to lowest supplied energy · click curve or use arrow keys to select a frame` : 'Energy plot requires explicit, consistent units in comments, e.g. energy=-12.3 Hartree. Unlabelled values are not interpreted.'}</small>
  </section>;
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { NativeIboRenderer } from '../render/NativeIboRenderer';
import { buildMolecule, buildOrbital, type MeshData } from '../render/geometry';
import type { DisplaySettings, Scene } from '../types';

export interface ViewerHandle {
  orient: (orientation: 'default' | 'top' | 'side') => void;
  exportPNG: () => string | undefined;
  zoom: (factor: number) => void;
}

interface Props {
  scene?: Scene;
  settings: DisplaySettings;
  theme: 'light' | 'dark';
  onStatus: (status: 'loading' | 'ready' | 'error', message?: string) => void;
}

const EMPTY: MeshData = {
  positions: new Float32Array(), normals: new Float32Array(),
  colors: new Float32Array(), indices: new Uint32Array(),
};

export const MoleculeViewer = forwardRef<ViewerHandle, Props>(function MoleculeViewer(
  { scene, settings, theme, onStatus }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<NativeIboRenderer | null>(null);
  const moleculeKey = useRef('');
  const molecule = useRef<{ key: string; mesh: MeshData } | undefined>(undefined);
  const orbital = useRef<{ text: string; isovalue: number; mesh: MeshData } | undefined>(undefined);
  const current = useRef({ scene, settings, theme });
  current.current = { scene, settings, theme };

  function drawLabels() {
    const layer = labels.current;
    const engine = renderer.current;
    if (!layer || !canvas.current || !engine) return;
    if (layer.width !== canvas.current.width || layer.height !== canvas.current.height) {
      layer.width = canvas.current.width;
      layer.height = canvas.current.height;
    }
    const context = layer.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, layer.width, layer.height);
    const state = current.current;
    if (!state.scene || !state.settings.labels) return;
    const scale = layer.width / (layer.clientWidth || 1);
    context.save();
    context.scale(scale, scale);
    context.font = '500 11px Figtree, sans-serif';
    state.scene.structure.atoms.forEach((atom, index) => {
      if (atom.element === 'H' && !state.settings.hydrogens) return;
      const [x, y] = engine.project(atom);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const text = `${atom.element}${index + 1}`;
      const width = context.measureText(text).width;
      context.fillStyle = state.theme === 'dark' ? '#202023ec' : '#ffffffdc';
      context.fillRect(x + 7, y + 2, width + 6, 16);
      context.fillStyle = state.theme === 'dark' ? '#fafafa' : '#61556e';
      context.fillText(text, x + 10, y + 14);
    });
    context.restore();
  }

  useImperativeHandle(ref, () => ({
    orient: (direction) => {
      const engine = renderer.current;
      if (direction === 'default') engine?.fit();
      engine?.orient(direction);
      drawLabels();
    },
    exportPNG: () => {
      if (!renderer.current || !canvas.current) return;
      renderer.current.render();
      drawLabels();
      const output = document.createElement('canvas');
      output.width = canvas.current.width;
      output.height = canvas.current.height;
      const context = output.getContext('2d')!;
      context.drawImage(canvas.current, 0, 0);
      if (labels.current && current.current.settings.labels) context.drawImage(labels.current, 0, 0);
      return output.toDataURL('image/png');
    },
    zoom: (factor) => { renderer.current?.zoom(factor); drawLabels(); },
  }));

  useEffect(() => {
    if (!canvas.current || !host.current) return;
    let observer: ResizeObserver | undefined;
    const element = canvas.current;
    const lost = (event: Event) => {
      event.preventDefault();
      onStatus('error', 'The graphics context was interrupted. Reload the page to restore the viewer.');
    };
    try {
      const engine = new NativeIboRenderer(element);
      renderer.current = engine;
      observer = new ResizeObserver(() => { engine.resize(); engine.render(); drawLabels(); });
      observer.observe(host.current);
      element.addEventListener('webglcontextlost', lost);
    } catch (cause) {
      onStatus('error', `This renderer needs WebGL2. ${cause instanceof Error ? cause.message : 'Enable graphics acceleration in your browser.'}`);
    }
    return () => {
      observer?.disconnect();
      element.removeEventListener('webglcontextlost', lost);
      renderer.current?.destroy();
      renderer.current = null;
    };
  }, [onStatus]);

  useEffect(() => {
    renderer.current?.setTheme(theme);
    renderer.current?.render();
    drawLabels();
  }, [theme, onStatus]);

  useEffect(() => {
    const engine = renderer.current;
    if (!engine || !scene) return;
    onStatus('loading');
    const timer = window.setTimeout(() => {
      try {
        const key = `${scene.key}/${settings.style}/${settings.hydrogens}`;
        const newMolecule = moleculeKey.current !== scene.key;
        let changed = false;
        if (molecule.current?.key !== key) {
          molecule.current = { key, mesh: buildMolecule(scene.structure.atoms, settings) };
          changed = true;
        }
        const text = settings.surface ? scene.volume?.cube ?? '' : '';
        if (orbital.current?.text !== text || orbital.current?.isovalue !== settings.isovalue) {
          orbital.current = { text, isovalue: settings.isovalue,
            mesh: text && scene.volume ? buildOrbital(scene.volume, settings.isovalue) : EMPTY };
          changed = true;
        }
        if (changed) engine.setMeshes(molecule.current.mesh, orbital.current!.mesh);
        engine.setMaterial(settings.material, settings.opacity);
        if (newMolecule) {
          moleculeKey.current = scene.key;
          engine.fit();
          engine.orient('default');
        }
        engine.render();
        drawLabels();
        onStatus('ready');
      } catch (cause) {
        onStatus('error', cause instanceof Error ? cause.message : 'Unable to render this structure.');
      }
    }, 45);
    return () => window.clearTimeout(timer);
  }, [scene, settings.isovalue, settings.opacity, settings.surface, settings.hydrogens, settings.style, settings.material, onStatus]);

  useEffect(() => {
    renderer.current?.setSpinning(settings.spinning);
  }, [settings.spinning]);

  useEffect(() => {
    let frame = 0;
    function updateLabels() { drawLabels(); frame = requestAnimationFrame(updateLabels); }
    drawLabels();
    if (settings.labels) frame = requestAnimationFrame(updateLabels);
    return () => cancelAnimationFrame(frame);
  }, [settings.labels]);

  return <div ref={host} className="molecule-canvas" role="img" aria-label="Interactive molecular structure and orbital isosurfaces">
    <canvas ref={canvas} className="native-gl-canvas" aria-hidden="true" />
    <canvas ref={labels} className="atom-label-canvas" aria-hidden="true" />
  </div>;
});

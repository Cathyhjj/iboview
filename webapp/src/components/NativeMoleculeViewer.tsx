import { DEFAULT_WORKSPACE, type WorkspaceState } from '../lib/workspace-state';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { NativeIboRenderer, type PNGExportOptions } from '../render/NativeIboRenderer';
import { buildMolecule, buildOrbital, recolorOrbital, type MeshData, type OrbitalMeshData } from '../render/geometry';
import { cameraKeyForStructure, loadCameraState, saveCameraState } from '../lib/camera-storage';
import { cropTransparentCanvas } from '../lib/png-crop';
import { DEFAULT_RENDER_QUALITY, RENDER_QUALITY_SETTINGS, type RenderQuality } from '../lib/render-quality';
import type { InteractiveView } from '../lib/interactive-scene';
import type { CameraState } from '../lib/camera-state';
import type { DisplaySettings, Scene } from '../types';

export interface ViewerHandle {
  orient: (orientation: 'default' | 'top' | 'side') => void;
  exportPNG: (options?: PNGExportOptions) => string | undefined;
  zoom: (factor: number) => void;
  getCameraState: () => CameraState | undefined;
  restoreCameraState: (camera: CameraState) => void;
  getInteractiveView: () => InteractiveView | undefined;
}

interface Props {
  scene?: Scene;
  settings: DisplaySettings;
  renderQuality?: RenderQuality;
  theme: 'light' | 'dark';
  initialCamera?: CameraState;
  workspace?: WorkspaceState;
  selectedAtoms?: number[];
  onCameraChange?: (camera: CameraState) => void;
  persistCamera?: boolean;
  cameraStorageKey?: string;
  onStatus: (status: 'loading' | 'ready' | 'error', message?: string) => void;
}

const EMPTY: OrbitalMeshData = {
  positions: new Float32Array(), normals: new Float32Array(),
  colors: new Float32Array(), indices: new Uint32Array(), positiveVertexCount: 0,
};

export const MoleculeViewer = forwardRef<ViewerHandle, Props>(function MoleculeViewer(
  { scene, settings, renderQuality = DEFAULT_RENDER_QUALITY, theme, initialCamera, onStatus, workspace = DEFAULT_WORKSPACE, selectedAtoms = [], onCameraChange, persistCamera = true, cameraStorageKey }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<NativeIboRenderer | null>(null);
  const moleculeKey = useRef('');
  const activeCameraKey = useRef('');
  const cameraDirty = useRef(false);
  const initializingCamera = useRef(false);
  const workspaceKey = JSON.stringify(workspace.atomOverrides);
  const cameraSaveTimer = useRef<number | undefined>(undefined);
  const viewKey = useMemo(() => scene ? cameraKeyForStructure(scene.structure.atoms) : '', [scene?.structure]);
  const molecule = useRef<{ key: string; mesh: MeshData } | undefined>(undefined);
  const orbital = useRef<{ text: string; isovalue: number; quality: RenderQuality; mesh: OrbitalMeshData; colors?: string } | undefined>(undefined);
  const current = useRef({ scene, settings, theme, workspace, selectedAtoms, onCameraChange, persistCamera });
  current.current = { scene, settings, theme, workspace, selectedAtoms, onCameraChange, persistCamera };

  function flushCamera() {
    window.clearTimeout(cameraSaveTimer.current);
    cameraSaveTimer.current = undefined;
    if (current.current.persistCamera && cameraDirty.current && renderer.current && activeCameraKey.current) {
      saveCameraState(activeCameraKey.current, renderer.current.getCameraState());
      cameraDirty.current = false;
    }
  }

  function scheduleCameraSave() {
    if (!current.current.persistCamera || !activeCameraKey.current) return;
    cameraDirty.current = true;
    if (cameraSaveTimer.current === undefined) {
      cameraSaveTimer.current = window.setTimeout(flushCamera, 250);
    }
  }

  function drawLabels(output?: HTMLCanvasElement) {
    const layer = output ?? labels.current;
    const engine = renderer.current;
    if (!layer || !canvas.current || !engine) return;
    if (!output && (layer.width !== canvas.current.width || layer.height !== canvas.current.height)) {
      layer.width = canvas.current.width;
      layer.height = canvas.current.height;
    }
    const context = layer.getContext('2d');
    if (!context) return;
    if (!output) context.clearRect(0, 0, layer.width, layer.height);
    const state = current.current;
    if (!state.scene) return;
    context.save();
    context.scale(layer.width / (canvas.current.clientWidth || 1), layer.height / (canvas.current.clientHeight || 1));
    context.font = '500 11px Figtree, sans-serif';
    if (!output) for (const index of state.selectedAtoms) {
      const atom = state.scene.structure.atoms[index];
      if (!atom || (!state.settings.hydrogens && atom.element === 'H')) continue;
      const [x, y] = engine.project(atom);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      context.beginPath(); context.arc(x, y, 12, 0, 2 * Math.PI);
      context.lineWidth = 2; context.strokeStyle = '#a276d7'; context.stroke();
    }
    if (state.settings.labels) state.scene.structure.atoms.forEach((atom, index) => {
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
    exportPNG: (options) => {
      if (!renderer.current || !canvas.current) return;
      const output = renderer.current.exportCanvas(options);
      drawLabels(output);
      return (options?.transparentBackground && options.cropTransparent ? cropTransparentCanvas(output) : output).toDataURL('image/png');
    },
    zoom: (factor) => { renderer.current?.zoom(factor); drawLabels(); },
    getCameraState: () => renderer.current?.getCameraState(),
    restoreCameraState: state => {
      if (renderer.current?.restoreCameraState(state)) { scheduleCameraSave(); drawLabels(); }
    },
    getInteractiveView: () => {
      const { scene, settings, theme } = current.current;
      if (!scene || !renderer.current || !molecule.current || !orbital.current || !canvas.current) return;
      return {
        title: scene.name, source: scene.fileName, orbital: settings.surface && scene.volume ? scene.orbital?.label ?? 'Orbital isosurface' : undefined,
        isovalue: settings.isovalue, molecule: molecule.current.mesh, orbitalMesh: orbital.current.mesh,
        camera: renderer.current.getCameraState(), aspect: canvas.current.clientWidth / Math.max(1, canvas.current.clientHeight),
        theme, settings: { material: settings.material, atomMaterial: settings.atomMaterial, opacity: settings.opacity, spinning: settings.spinning },
        labels: settings.labels ? scene.structure.atoms.flatMap((atom, index) => atom.element === 'H' && !settings.hydrogens
          ? [] : [{ text: `${atom.element}${index + 1}`, x: atom.x, y: atom.y, z: atom.z }]) : [],
      };
    },
  }), []);

  useEffect(() => {
    if (!canvas.current || !host.current) return;
    let observer: ResizeObserver | undefined;
    const element = canvas.current;
    const lost = (event: Event) => {
      event.preventDefault();
      onStatus('error', 'The graphics context was interrupted. Reload the page to restore the viewer.');
    };
    const hidden = () => { if (document.visibilityState === 'hidden') flushCamera(); };
    try {
      const engine = new NativeIboRenderer(element);
      renderer.current = engine;
      engine.setCameraChangeListener(() => {
        if (!initializingCamera.current) current.current.onCameraChange?.(engine.getCameraState());
        scheduleCameraSave(); drawLabels();
      });
      observer = new ResizeObserver(() => { engine.resize(); engine.render(); drawLabels(); });
      observer.observe(host.current);
      element.addEventListener('webglcontextlost', lost);
      window.addEventListener('pagehide', flushCamera);
      document.addEventListener('visibilitychange', hidden);
    } catch (cause) {
      onStatus('error', `This renderer needs WebGL2. ${cause instanceof Error ? cause.message : 'Enable graphics acceleration in your browser.'}`);
    }
    return () => {
      flushCamera();
      activeCameraKey.current = '';
      moleculeKey.current = '';
      molecule.current = undefined;
      orbital.current = undefined;
      observer?.disconnect();
      element.removeEventListener('webglcontextlost', lost);
      window.removeEventListener('pagehide', flushCamera);
      document.removeEventListener('visibilitychange', hidden);
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
        const key = JSON.stringify([scene.key, viewKey, workspaceKey, renderQuality, settings.style, settings.hydrogens,
          settings.atomScale, settings.hydrogenScale, settings.bondScale, settings.bonds, settings.bondStyle,
          settings.atomPalette, settings.atomColor, settings.elementColors, settings.bondColorMode, settings.bondColor]);
        const newMolecule = moleculeKey.current !== scene.key;
        let changed = false;
        if (molecule.current?.key !== key) {
          molecule.current = { key, mesh: buildMolecule(scene.structure.atoms, settings, renderQuality, workspace.atomOverrides) };
          changed = true;
        }
        const text = settings.surface ? scene.volume?.cube ?? '' : '';
        if (orbital.current?.text !== text || orbital.current?.isovalue !== settings.isovalue || orbital.current?.quality !== renderQuality) {
          orbital.current = { text, isovalue: settings.isovalue, quality: renderQuality,
            mesh: text && scene.volume ? buildOrbital(scene.volume, settings.isovalue, RENDER_QUALITY_SETTINGS[renderQuality].orbitalRefinement) : EMPTY };
          changed = true;
        }
        const colors = JSON.stringify([settings.positiveColor, settings.negativeColor, settings.orbitalGradient]);
        const colorsChanged = orbital.current!.colors !== colors;
        if (colorsChanged) {
          recolorOrbital(orbital.current!.mesh, settings.positiveColor, settings.negativeColor, settings.orbitalGradient);
          orbital.current!.colors = colors;
        }
        if (changed) engine.setMeshes(molecule.current.mesh, orbital.current!.mesh);
        else if (colorsChanged) engine.setOrbitalColors(orbital.current!.mesh.colors);
        engine.setMaterial(settings.material, settings.opacity, settings.atomMaterial);
        if (newMolecule) {
          initializingCamera.current = true;
          flushCamera();
          activeCameraKey.current = '';
          cameraDirty.current = false;
          moleculeKey.current = scene.key;
          engine.fit();
          engine.orient('default');
          const savedView = initialCamera ?? (persistCamera ? loadCameraState(cameraStorageKey ?? viewKey) : undefined);
          if (savedView) engine.restoreCameraState(savedView);
          activeCameraKey.current = cameraStorageKey ?? viewKey;
          initializingCamera.current = false;
          if (initialCamera) scheduleCameraSave();
        }
        engine.render();
        drawLabels();
        onStatus('ready');
      } catch (cause) {
        initializingCamera.current = false;
        onStatus('error', cause instanceof Error ? cause.message : 'Unable to render this structure.');
      }
    }, 45);
    return () => window.clearTimeout(timer);
  }, [scene, viewKey, workspaceKey, renderQuality, initialCamera, persistCamera, cameraStorageKey, settings.isovalue, settings.opacity, settings.surface, settings.hydrogens, settings.style,
    settings.atomScale, settings.hydrogenScale, settings.bondScale, settings.bonds, settings.bondStyle,
    settings.atomPalette, settings.atomColor, settings.elementColors, settings.bondColorMode, settings.bondColor,
    settings.atomMaterial, settings.material, settings.positiveColor, settings.negativeColor, settings.orbitalGradient, onStatus]);

  useEffect(() => {
    renderer.current?.setSpinning(settings.spinning);
  }, [settings.spinning]);

  useEffect(() => {
    let frame = 0;
    function updateLabels() { drawLabels(); frame = requestAnimationFrame(updateLabels); }
    drawLabels();
    if (settings.labels || selectedAtoms.length) frame = requestAnimationFrame(updateLabels);
    return () => cancelAnimationFrame(frame);
  }, [settings.labels, selectedAtoms]);

  return <div ref={host} className="molecule-canvas" role="img" aria-label="Interactive molecular structure and orbital isosurfaces">
    <canvas ref={canvas} className="native-gl-canvas" aria-hidden="true" />
    <canvas ref={labels} className="atom-label-canvas" aria-hidden="true" />
  </div>;
});

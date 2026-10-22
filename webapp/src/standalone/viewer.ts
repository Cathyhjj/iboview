import { NativeIboRenderer } from '../render/NativeIboRenderer';
import { unpackMesh, type PackedInteractiveView } from '../lib/interactive-scene';

const canvas = document.getElementById('molecule') as HTMLCanvasElement;
const labels = document.getElementById('labels') as HTMLCanvasElement;
const spin = document.getElementById('spin') as HTMLButtonElement;
const error = document.getElementById('error')!;
try {
  const data = JSON.parse(document.getElementById('iboview-scene')!.textContent!) as PackedInteractiveView;
  if (data.version !== 1) throw new Error('This molecular view uses an unsupported file version.');
  const engine = new NativeIboRenderer(canvas);
  engine.setMeshes(unpackMesh(data.molecule), unpackMesh(data.orbitalMesh));
  engine.setTheme(data.theme);
  engine.setMaterial(data.settings.material, data.settings.opacity, data.settings.atomMaterial);
  let rotating = data.settings.spinning;
  function drawLabels() {
    if (labels.width !== canvas.width || labels.height !== canvas.height) { labels.width = canvas.width; labels.height = canvas.height; }
    const context = labels.getContext('2d')!;
    context.clearRect(0, 0, labels.width, labels.height);
    context.save();
    context.scale(labels.width / Math.max(1, canvas.clientWidth), labels.height / Math.max(1, canvas.clientHeight));
    context.font = '500 11px Figtree, sans-serif';
    for (const atom of data.labels) {
      const [x, y] = engine.project(atom);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const width = context.measureText(atom.text).width;
      context.fillStyle = data.theme === 'dark' ? '#202023ec' : '#ffffffdc';
      context.fillRect(x + 7, y + 2, width + 6, 16);
      context.fillStyle = data.theme === 'dark' ? '#fafafa' : '#61556e';
      context.fillText(atom.text, x + 10, y + 14);
    }
    context.restore();
  }
  function setSpinning(value: boolean) {
    rotating = value;
    engine.setSpinning(value && !document.hidden);
    spin.textContent = value ? 'Pause rotation' : 'Auto rotate';
    spin.setAttribute('aria-pressed', String(value));
  }
  let previousAspect = data.aspect;
  function resize() {
    const aspect = Math.max(.01, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const camera = engine.getCameraState();
    const scale = Math.min(1, previousAspect) / Math.min(1, aspect);
    camera.halfHeight *= scale;
    camera.fittedHalfHeight *= scale;
    previousAspect = aspect;
    engine.resize();
    engine.restoreCameraState(camera);
    drawLabels();
  }
  function reset() {
    setSpinning(false);
    const aspect = Math.max(.01, canvas.clientWidth / Math.max(1, canvas.clientHeight));
    const scale = Math.min(1, data.aspect) / Math.min(1, aspect);
    engine.restoreCameraState({ ...data.camera, halfHeight: data.camera.halfHeight * scale, fittedHalfHeight: data.camera.fittedHalfHeight * scale });
    previousAspect = aspect;
    drawLabels();
  }
  engine.setCameraChangeListener(drawLabels);
  if (!engine.restoreCameraState(data.camera)) throw new Error('The saved camera is invalid.');
  resize();
  setSpinning(rotating);
  spin.onclick = () => setSpinning(!rotating);
  document.getElementById('zoom-in')!.onclick = () => engine.zoom(1.2);
  document.getElementById('zoom-out')!.onclick = () => engine.zoom(1 / 1.2);
  document.getElementById('reset')!.onclick = reset;
  canvas.addEventListener('keydown', event => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); engine.zoom(1.2); }
    if (event.key === '-') { event.preventDefault(); engine.zoom(1 / 1.2); }
    if (event.key === ' ') { event.preventDefault(); setSpinning(!rotating); }
    if (event.key === 'Home') { event.preventDefault(); reset(); }
    const step = .08, axes: Record<string, [number, number, number]> = { ArrowLeft: [0,-1,0], ArrowRight: [0,1,0], ArrowUp: [-1,0,0], ArrowDown: [1,0,0] };
    const axis = axes[event.key];
    if (axis) {
      event.preventDefault();
      const state = engine.getCameraState(), [x,y,z,w] = state.rotation;
      const [u,v,s] = axis.map(value => value * Math.sin(step/2)), t = Math.cos(step/2);
      state.rotation = [t*x+u*w+v*z-s*y,t*y-u*z+v*w+s*x,t*z+u*y-v*x+s*w,t*w-u*x-v*y-s*z];
      engine.restoreCameraState(state); drawLabels();
    }
  });
  const observer = new ResizeObserver(resize);
  observer.observe(document.getElementById('viewer')!);
  document.addEventListener('visibilitychange', () => engine.setSpinning(rotating && !document.hidden));
  canvas.addEventListener('webglcontextlost', () => { error.hidden = false; error.textContent = 'Graphics were interrupted. Reload this file to restore the molecule.'; });
  window.addEventListener('pagehide', () => engine.setSpinning(false));
  window.addEventListener('pageshow', () => engine.setSpinning(rotating && !document.hidden));
  void document.fonts.ready.then(drawLabels);
  document.documentElement.dataset.viewerReady = 'true';
} catch (cause) {
  error.textContent = cause instanceof Error ? cause.message : 'Unable to display this molecular view.';
  error.hidden = false;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
}

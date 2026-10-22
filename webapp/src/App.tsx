import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Atom, Upload, Download, ChevronRight, RotateCcw, Play, Pause, Plus, Minus,
  Eye, SlidersHorizontal, X, FileText, Info, Hexagon, Layers3, ArrowUpRight,
  Check, MousePointer2, LoaderCircle, ShieldCheck, Moon, Sun,
} from 'lucide-react';
import { MoleculeViewer, type ViewerHandle } from './components/NativeMoleculeViewer';
import { OrbitalColorControl } from './components/OrbitalColorControl';
import { MolecularAppearanceControl } from './components/MolecularAppearanceControl';
import { DEFAULT_MOLECULE_APPEARANCE, normalizeMoleculeAppearance, readMoleculeAppearance, REPRESENTATIONS } from './lib/molecule-appearance';
import { formulaFor, parseCube, parseXYZ } from './lib/importers';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors } from './lib/orbital-colors';
import { loadOrbitalColors } from './lib/orbital-color-storage';
import { DEFAULT_DISPLAY_PREFERENCES, loadDisplayPreferences } from './lib/display-preferences';
import { applyMoleculeViewPreferences, loadMoleculeViewPreferences, moleculeViewPreferences, saveMoleculeViewPreferences } from './lib/molecule-view-preferences';
import { loadDemoOrbital, loadDemoSelection, loadRememberedDemo, saveDemoSelection } from './lib/demo-selection-storage';
import { cameraKeyForStructure } from './lib/camera-storage';
import { loadOrbitalSurfacePreferences, restoreOrbitalSurfacePreferences, saveOrbitalSurfacePreferences } from './lib/orbital-surface-storage';
import { assetURL, createDemoLoader, DEMOS, demoManifestURL, orbitalKind } from './lib/demos';
import type { DemoManifest, DisplaySettings, Scene } from './types';
import './components/demo-selector.css';

const DEFAULTS: DisplaySettings = {
  ...DEFAULT_MOLECULE_APPEARANCE,
  ...DEFAULT_DISPLAY_PREFERENCES,
  isovalue: 0.045, surface: true, spinning: false,
  ...orbitalPhaseColors(DEFAULT_ORBITAL_COLORS),
};
const formatValue = (value: number) => value > 0 && (value < 0.001 || value >= 100) ? value.toExponential(2) : value.toFixed(3);
const importedRange = (peak: number) => {
  const max = peak > 0 ? peak * 0.95 : 1;
  return { min: max / 1000, max };
};

function Formula({ value }: { value: string }) {
  return <>{value.split(/(\d+)/).map((part, i) => /^\d+$/.test(part) ? <sub key={i}>{part}</sub> : part)}</>;
}

function Toggle({ label, checked, onChange, disabled = false }: {
  label: string; checked: boolean; onChange: () => void; disabled?: boolean;
}) {
  return <button className="toggle-row" role="switch" aria-checked={checked} disabled={disabled} onClick={onChange}>
    <span>{label}</span><span className={`switch ${checked ? 'on' : ''}`} aria-hidden="true"><span /></span>
  </button>;
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const [manifest, setManifest] = useState<DemoManifest>();
  const [scene, setScene] = useState<Scene>();
  const [settings, setSettings] = useState<DisplaySettings>(() => ({ ...DEFAULTS, ...readMoleculeAppearance(), ...loadDisplayPreferences() }));
  const surfaceKey = useMemo(() => scene ? cameraKeyForStructure(scene.structure.atoms) : undefined, [scene?.structure]);
  const hasVolume = !!scene?.volume;
  const [appearanceTab, setAppearanceTab] = useState<'molecule' | 'orbital'>('molecule');
  const [colors, setColors] = useState(() => loadOrbitalColors());
  const [appearanceFallback] = useState(() => moleculeViewPreferences(settings, colors));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pendingId, setPendingId] = useState('');
  const [pendingDemo, setPendingDemo] = useState('');
  const [toast, setToast] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const viewer = useRef<ViewerHandle>(null);
  const about = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const loadDemo = useRef(createDemoLoader());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17171c' : '#faf9f5');
    try { localStorage.setItem('iboview-theme', theme); } catch { /* Storage may be unavailable in private sessions. */ }
  }, [theme]);

  const { isovalue, surface } = settings;
  useEffect(() => {
    if (hasVolume && surfaceKey && !loadOrbitalSurfacePreferences(surfaceKey)) {
      saveOrbitalSurfacePreferences(surfaceKey, { isovalue, surface });
    }
  }, [surfaceKey, hasVolume, isovalue, surface]);

  const savedViewAppearance = JSON.stringify(moleculeViewPreferences(settings, colors));
  useEffect(() => {
    if (surfaceKey) saveMoleculeViewPreferences(surfaceKey, JSON.parse(savedViewAppearance));
  }, [surfaceKey, scene?.key, savedViewAppearance]);

  const update = <K extends keyof DisplaySettings,>(key: K, value: DisplaySettings[K]) => {
    if ((key === 'isovalue' || key === 'surface') && hasVolume && surfaceKey) {
      saveOrbitalSurfacePreferences(surfaceKey, { ...settings, [key]: value });
    }
    setSettings(previous => ({ ...previous, [key]: value }));
  };
  const onRenderStatus = useCallback((status: 'loading' | 'ready' | 'error', message?: string) => {
    setRenderStatus(status);
    setRenderError(message ?? '');
  }, []);

  async function showDemo(id = 'benzene', orbitalId?: string) {
    const ticket = ++request.current;
    const rememberedOrbital = orbitalId ?? loadDemoOrbital(id);
    setBusy(true);
    setError('');
    setPendingId(rememberedOrbital ?? '');
    setPendingDemo(id);
    try {
      const { manifest: data, orbital: chosen, structure, volume } = orbitalId === undefined
        ? await loadRememberedDemo(loadDemo.current, { demoId: id, orbitalId: rememberedOrbital })
        : await loadDemo.current(id, orbitalId);
      if (ticket !== request.current) return;
      saveDemoSelection({ demoId: data.id, orbitalId: chosen.id });
      setManifest(data);
      setScene({ key: `${data.id}-demo`, name: data.name, formula: data.formula, structure, volume,
        kind: 'demo', fileName: data.source.file.split('/').pop()!, orbital: chosen });
      const key = cameraKeyForStructure(structure.atoms);
      const savedSurface = loadOrbitalSurfacePreferences(key);
      const savedAppearance = loadMoleculeViewPreferences(key) ?? appearanceFallback;
      if (surfaceKey !== key) setColors(savedAppearance.colors);
      setSettings(previous => ({ ...(surfaceKey === key ? previous : applyMoleculeViewPreferences(previous, savedAppearance)),
        ...restoreOrbitalSurfacePreferences(hasVolume && surfaceKey === key ? previous : savedSurface,
          { surface: true, isovalue: chosen.isovalue }, { min: data.isovalueMin ?? 0.015, max: 0.12 }),
        spinning: scene?.key === `${data.id}-demo` ? previous.spinning : false }));
      setRenderStatus('loading');
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause.message : 'The demo could not be loaded.');
    } finally {
      if (ticket === request.current) { setBusy(false); setPendingId(''); setPendingDemo(''); }
    }
  }

  useEffect(() => {
    const saved = loadDemoSelection();
    void showDemo(saved.demoId);
    return () => { request.current++; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function importFile(file?: File) {
    if (!file) return;
    const ticket = ++request.current;
    setBusy(true);
    setError('');
    setPendingId('');
    setPendingDemo('');
    try {
      if (file.size > 35 * 1024 * 1024) throw new Error('This preview supports files up to 35 MB. Use a smaller Cube grid.');
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!['cube', 'cub', 'xyz'].includes(extension ?? '')) throw new Error('Choose a Gaussian Cube (.cube, .cub) or XYZ (.xyz) file.');
      const text = await file.text();
      const volume = extension === 'xyz' ? undefined : parseCube(text);
      const structure = volume ?? parseXYZ(text);
      if (ticket !== request.current) return;
      setManifest(undefined);
      setScene({ key: `local-${ticket}`, name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name,
        kind: volume ? 'cube' : 'xyz', formula: formulaFor(structure.atoms), structure, volume });
      const peak = volume ? Math.max(Math.abs(volume.range[0]), Math.abs(volume.range[1])) : 0;
      const range = importedRange(peak);
      const key = cameraKeyForStructure(structure.atoms);
      const savedSurface = volume ? loadOrbitalSurfacePreferences(key) : undefined;
      const savedAppearance = loadMoleculeViewPreferences(key) ?? appearanceFallback;
      if (surfaceKey !== key) setColors(savedAppearance.colors);
      const defaultSurface = { surface: true, isovalue: volume
        ? Math.max(range.min, Math.min(range.max, Math.min(0.045, peak * 0.2) || 0.045)) : 0.045 };
      setSettings(previous => ({ ...(surfaceKey === key ? previous : applyMoleculeViewPreferences(DEFAULTS, savedAppearance)),
        spinning: false,
        ...restoreOrbitalSurfacePreferences(volume && hasVolume && surfaceKey === key ? previous : savedSurface,
          defaultSurface, range) }));
      setRenderStatus('loading');
    } catch (cause) {
      if (ticket === request.current) setError(cause instanceof Error ? cause.message : 'This file could not be opened.');
    } finally {
      if (ticket === request.current) setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  function exportPNG() {
    const png = viewer.current?.exportPNG();
    if (!png) return;
    const bytes = Uint8Array.from(atob(png.split(',')[1]), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${scene?.name.replace(/[^a-zA-Z0-9_-]/g, '-') ?? 'molecule'}-${scene?.orbital?.id ?? 'view'}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    setToast('PNG download requested for the current view.');
  }

  const isDemo = scene?.kind === 'demo';
  const peak = scene?.volume ? Math.max(Math.abs(scene.volume.range[0]), Math.abs(scene.volume.range[1])) : 1;
  const isoMax = isDemo ? 0.12 : importedRange(peak).max;
  const isoMin = isDemo ? manifest?.isovalueMin ?? 0.015 : importedRange(peak).min;
  const noSurface = hasVolume && settings.isovalue > peak;
  const ready = renderStatus === 'ready' && !busy;
  const phaseColors = useMemo(() => orbitalPhaseColors(colors), [colors]);
  const viewerSettings = useMemo(() => ({ ...settings, ...phaseColors, orbitalGradient: phaseColors.orbitalGradient }), [settings, phaseColors]);
  const selectedDemo = pendingDemo || (isDemo ? manifest?.id : '') || '';
  const demoDetail = DEMOS.find(demo => demo.id === selectedDemo)?.detail;

  return <div className="app-shell" style={{ '--positive': phaseColors.positiveColor, '--negative': phaseColors.negativeColor } as CSSProperties}>
    <header className="app-header">
      <a className="brand" href="./" aria-label="IboView home"><span className="brand-mark"><Atom size={25} strokeWidth={1.6} /></span>
        <span>Ibo<span className="brand-light">View</span></span><span className="preview-badge">WEB PREVIEW</span>
      </a>
      <div className="header-center"><span>Workspace</span><ChevronRight size={13} /><strong>Molecular orbitals</strong></div>
      <div className="header-actions">
        <button className="theme-toggle" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
          onClick={() => setTheme(previous => previous === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}<span>{theme === 'dark' ? 'Light mode' : 'Night mode'}</span>
        </button>
        <button className="icon-button" aria-label="About this demo" onClick={() => about.current?.showModal()}><Info size={19} /></button>
      </div>
    </header>

    <main className="page-body">
      <section className="page-heading">
        <div><div className="eyebrow">A CLOSER LOOK AT CHEMICAL BONDING</div><h1>Molecular workspace<span className="title-dot">.</span></h1>
          <p>Explore a molecule. Discover the orbitals behind its bonds.</p></div>
        <div className="heading-actions">
          <button className="button secondary" disabled={!ready} onClick={exportPNG}><Download size={16} />Export PNG</button>
          <button className="button primary" onClick={() => input.current?.click()}><Upload size={16} />Open file</button>
          <input ref={input} className="visually-hidden" type="file" accept=".xyz,.cube,.cub" aria-label="Open molecular file" onChange={event => void importFile(event.target.files?.[0])} />
        </div>
      </section>

      {error && <div className="error-banner" role="alert"><Info size={17} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}

      <div className="workspace">
        <aside className="library-panel panel" aria-label="Molecule and orbitals">
          <div className="panel-label"><Layers3 size={15} /><span>EXPLORER</span></div>
          <div className="demo-selector">
            <label htmlFor="demo-example">Demo example <span>{DEMOS.length} examples</span></label>
            <select id="demo-example" value={selectedDemo} aria-describedby="demo-detail"
              onChange={event => void showDemo(event.target.value)}>
              <option value="" disabled>Choose an example</option>
              {DEMOS.map(demo => <option key={demo.id} value={demo.id}>{demo.name}</option>)}
            </select>
            <p id="demo-detail">{pendingDemo && pendingDemo !== manifest?.id ? 'Loading example…' : demoDetail ?? 'Explore the bundled orbital examples.'}</p>
          </div>
          <div className="molecule-card">
            <span className="molecule-symbol"><Hexagon size={32} strokeWidth={1.4} /><span /></span>
            <div className="molecule-name"><h2 title={scene?.name}>{scene?.name ?? 'Benzene'}</h2><div className="formula"><span><Formula value={scene?.formula ?? 'C6H6'} /></span><span>·</span><span>{scene?.structure.atoms.length ?? 12} atoms</span></div></div>
            {isDemo && <span className="demo-tag">DEMO</span>}
          </div>
          <div className="file-line"><FileText size={13} /><span title={scene?.fileName}>{scene?.fileName ?? 'benzene.xml'}</span><Check size={13} className="success-text" /></div>
          <div className="section-divider" />
          <div className="list-heading"><h3>{isDemo || !scene ? 'Bonding orbitals' : hasVolume ? 'Volume data' : 'Structure'}</h3><span className="count">{isDemo || !scene ? manifest?.orbitals.length ?? 5 : hasVolume ? 1 : 0}</span></div>
          <p className="section-caption">{isDemo || !scene ? 'Intrinsic bonding orbitals · occupied' : hasVolume ? 'Imported scalar field' : 'Geometry from your local file'}</p>
          <div className="orbital-list">
            {(isDemo || !scene) && manifest?.orbitals.map(orbital => <button key={orbital.id}
              className={`orbital-item ${scene?.orbital?.id === orbital.id ? 'selected' : ''}`}
              title={orbital.description} aria-pressed={scene?.orbital?.id === orbital.id} onClick={() => void showDemo(manifest.id, orbital.id)}>
              <span className={`orbital-glyph ${orbital.label.startsWith('σ') ? 'sigma' : ''}`} aria-hidden="true"><i /><i /></span>
              <span className="orbital-copy"><strong>{orbital.label}</strong><small>{orbitalKind(orbital)}<span>{orbital.occupation} electrons</span></small></span>
              {pendingId === orbital.id ? <LoaderCircle size={15} className="loading-spin" /> : scene?.orbital?.id === orbital.id ? <Eye size={15} /> : null}
            </button>)}
            {scene && !isDemo && <div className="imported-item"><FileText size={20} /><div><strong>{hasVolume ? 'Scalar field' : 'Molecular geometry'}</strong><p>{hasVolume ? 'One dataset · Cube' : 'XYZ · coordinates in Å'}</p></div></div>}
          </div>
          <div className="library-bottom">
            <div className="hint-card"><Atom size={18} /><p>{isDemo || !scene ? 'One orbital, two phases. The colors show the sign of the wavefunction, not charge.' : hasVolume ? 'Colors show positive and negative field values. Field identity and units come from your calculation.' : 'XYZ contains geometry only. Open a Cube file to display a volumetric field.'}</p></div>
            <button className="demo-link" onClick={() => void showDemo(manifest?.id)}><RotateCcw size={14} />Reload demo<ArrowUpRight size={15} /></button>
          </div>
        </aside>

        <section className="viewport-panel panel" aria-label="Molecular viewer" data-render-state={renderStatus}>
          <div className="viewport-header"><div className="viewport-title"><span className="tiny-dot" /><strong>IboView renderer</strong></div>
            <span className="viewport-mode">{REPRESENTATIONS.find(item => item.id === settings.style)?.name}<span className="subtle-separator">/</span>Orthographic</span></div>
          <div className="viewport-stage">
            <MoleculeViewer ref={viewer} scene={scene} settings={viewerSettings} theme={theme} onStatus={onRenderStatus} />
            <div className="scene-label"><span>{isDemo ? `${scene.name.toUpperCase()} / IBO` : scene?.kind === 'cube' ? 'LOCAL / CUBE' : scene ? 'LOCAL / XYZ' : 'BENZENE / IBO'}</span><strong>{scene?.orbital?.label ?? (hasVolume ? 'Scalar field' : scene?.name ?? 'Loading orbitals…')}</strong></div>
            <div className="viewport-tools">
              <button className="icon-button" aria-label="Zoom in" disabled={!ready} onClick={() => viewer.current?.zoom(1.15)}><Plus size={17} /></button>
              <button className="icon-button" aria-label="Zoom out" disabled={!ready} onClick={() => viewer.current?.zoom(0.87)}><Minus size={17} /></button>
              <span />
              <button className="icon-button" aria-label="Reset view" disabled={!ready} onClick={() => { update('spinning', false); viewer.current?.orient('default'); }}><RotateCcw size={16} /></button>
            </div>
            {hasVolume && settings.surface && <div className="phase-legend"><span><i className="phase positive" />{isDemo ? '+ψ' : '+ value'}</span><span><i className="phase negative" />{isDemo ? '−ψ' : '− value'}</span><span className="iso-legend">±{formatValue(settings.isovalue)}</span></div>}
            {(busy || (renderStatus === 'loading' && scene)) && <div className="loading-badge" role="status"><LoaderCircle size={14} className="loading-spin" />Preparing orbital…</div>}
            {noSurface && <div className="viewer-notice">Lower the isovalue to see this field.</div>}
            {renderError && <div className="viewer-error" role="alert"><Info size={28} /><h3>Unable to display the 3D view</h3><p>{renderError}</p><button className="button secondary" onClick={() => window.location.reload()}>Reload viewer</button></div>}
            <div className="view-controls"><button aria-label={settings.spinning ? 'Pause rotation' : 'Rotate molecule'} aria-pressed={settings.spinning} disabled={!ready} className={settings.spinning ? 'active' : ''} onClick={() => update('spinning', !settings.spinning)}>{settings.spinning ? <Pause size={14} /> : <Play size={14} />}<span>{settings.spinning ? 'Pause' : 'Rotate'}</span></button>
              <span className="control-divider" /><button disabled={!ready} onClick={() => { update('spinning', false); viewer.current?.orient('top'); }}>Top</button><button disabled={!ready} onClick={() => { update('spinning', false); viewer.current?.orient('side'); }}>Side</button><button disabled={!ready} onClick={() => { update('spinning', false); viewer.current?.orient('default'); }}>3D</button></div>
          </div>
          <div className="viewport-footer"><span><MousePointer2 size={13} />Drag to rotate<span className="footer-dot">·</span>Scroll to zoom<span className="footer-dot">·</span>Right-drag to pan</span><span className={`render-indicator ${renderStatus === 'error' ? 'failed' : ''}`}><i />{renderStatus === 'error' ? 'WebGL unavailable' : ready ? 'Rendered locally' : 'Loading'}</span></div>
        </section>

        <aside className="appearance-panel panel" aria-label="Display settings">
          <div className="panel-label"><SlidersHorizontal size={15} /><span>APPEARANCE</span></div>
          <div className="appearance-tabs" role="tablist" aria-label="Appearance category">
            <button id="molecule-tab" role="tab" aria-selected={appearanceTab === 'molecule'} aria-controls="molecule-appearance" tabIndex={appearanceTab === 'molecule' ? 0 : -1} onClick={() => setAppearanceTab('molecule')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'End'].includes(event.key)) { event.preventDefault(); setAppearanceTab('orbital'); document.getElementById('orbital-tab')?.focus(); } }}><Atom size={14} />Molecule</button>
            <button id="orbital-tab" role="tab" aria-selected={appearanceTab === 'orbital'} aria-controls="orbital-appearance" tabIndex={appearanceTab === 'orbital' ? 0 : -1} onClick={() => setAppearanceTab('orbital')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home'].includes(event.key)) { event.preventDefault(); setAppearanceTab('molecule'); document.getElementById('molecule-tab')?.focus(); } }}><Layers3 size={14} />Orbital</button>
          </div>
          <div className="appearance-content" id="molecule-appearance" role="tabpanel" aria-labelledby="molecule-tab" hidden={appearanceTab !== 'molecule'}>
            <MolecularAppearanceControl value={settings} elements={[...new Set(scene?.structure.atoms.map(atom => atom.element) ?? [])]} onChange={value => setSettings(previous => ({ ...previous, ...normalizeMoleculeAppearance(value) }))} />
          </div>
          <div className="appearance-content" id="orbital-appearance" role="tabpanel" aria-labelledby="orbital-tab" hidden={appearanceTab !== 'orbital'}>
          <div className="material-control"><label htmlFor="material">Orbital lighting & material</label><select id="material" value={settings.material} onChange={event => update('material', event.target.value as DisplaySettings['material'])}><option value="shiny">Shiny chic</option><option value="extra">Extra shiny</option><option value="soft">Soft studio</option></select></div>
          <div className="settings-section">
            <Toggle label="Orbital surface" checked={settings.surface && hasVolume} disabled={!hasVolume} onChange={() => update('surface', !settings.surface)} />
            <div className={`surface-settings ${!hasVolume || !settings.surface ? 'muted-controls' : ''}`}>
              <label className="slider-label" htmlFor="isovalue"><span>Isovalue <small>{isDemo ? 'a.u.' : 'file units'}</small></span><output>{formatValue(settings.isovalue)}</output></label>
              <input id="isovalue" type="range" min={isoMin} max={isoMax} step={isDemo ? 0.001 : 'any'} value={settings.isovalue} disabled={!hasVolume || !settings.surface} onChange={event => update('isovalue', Number(event.target.value))} />
              <div className="range-labels"><span>Diffuse</span><span>Compact</span></div>
              <label className="slider-label" htmlFor="opacity"><span>Opacity</span><output>{Math.round(settings.opacity * 100)}%</output></label>
              <input id="opacity" type="range" min="0.2" max="1" step="0.01" value={settings.opacity} disabled={!hasVolume || !settings.surface} onChange={event => update('opacity', Number(event.target.value))} />
              <OrbitalColorControl value={colors} onChange={setColors} disabled={!hasVolume || !settings.surface} isDemo={isDemo} />
            </div>
          </div>
          </div>
          <div className="data-details"><div className="panel-label"><FileText size={14} /><span>DATA DETAILS</span></div>
            <dl><div><dt>Method</dt><dd>{isDemo ? manifest?.method.replace(/ · IBO$/, '') : 'Imported'}</dd></div><div><dt>Orbital type</dt><dd>{isDemo ? 'Localized IBO' : hasVolume ? 'Unspecified field' : 'Geometry only'}</dd></div>
              {isDemo && <div><dt>Occupation</dt><dd>{scene.orbital?.occupation.toFixed(1)} e⁻</dd></div>}
              {hasVolume && <div><dt>Volume grid</dt><dd>{scene.volume!.dimensions.join(' × ')}</dd></div>}
              <div><dt>Coordinates</dt><dd>Å</dd></div></dl>
            <button className="text-link" onClick={() => about.current?.showModal()}>About the data<ArrowUpRight size={13} /></button>
          </div>
        </aside>
      </div>

      <footer className="page-footer"><span><ShieldCheck size={14} />Your files stay in this browser.</span><span>IboView Web <span className="footer-dot">·</span> v0.1<span className="footer-dot">·</span> Structure & orbital viewer</span></footer>
    </main>
    {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
    <dialog ref={about} className="about-dialog" onClick={event => { if (event.target === about.current) about.current.close(); }}>
      <div className="dialog-heading"><span className="brand-mark"><Atom size={23} /></span><button className="icon-button" aria-label="Close about dialog" onClick={() => about.current?.close()}><X size={20} /></button></div>
      <div className="eyebrow">IBOVIEW WEB / FIRST PREVIEW</div><h2>Real orbitals. A new perspective.</h2>
      <p>The examples use original Molpro wavefunctions bundled with IboView, with localized intrinsic bonding orbitals. Choose a molecule in the Demo example menu to explore its selected occupied orbitals.</p>
      {manifest && <p><strong>{manifest.name}</strong>{manifest.description ? ` — ${manifest.description}` : ''}<br />Source: <code>{manifest.source.file}</code>. {manifest.method}; {manifest.orbitals.length} selected IBOs on a {manifest.grid.spacingBohr.toFixed(2)}-bohr grid.</p>}
      <p>Orbitals are evaluated from their original Gaussian basis and coefficients. The two surface colors encode the sign of ψ; they do not represent positive and negative charge. Isovalues are orbital amplitudes in bohr<sup>−3/2</sup>.</p>
      <p>The renderer reuses IboView’s original lighting and transparency shaders in WebGL2, with its three-light setup, shiny material presets and layered depth peeling. The surface tracer follows the desktop viewer’s cube-edge algorithm.</p>
      <p>This first web version provides structure and volume visualization. The desktop SCF, IAO/IBO localization and bond-order analysis engines have not been ported. Uploaded Cube values retain their source units; XYZ provides geometry only. Bonds are inferred from interatomic distances.</p>
      <div className="dialog-links"><a href={assetURL(demoManifestURL(manifest?.id ?? 'benzene'))} target="_blank" rel="noreferrer">{manifest?.name ?? 'Benzene'} provenance<ArrowUpRight size={14} /></a></div>
      <button className="button primary dialog-done" onClick={() => about.current?.close()}>Back to exploring<ChevronRight size={15} /></button>
    </dialog>
  </div>;
}

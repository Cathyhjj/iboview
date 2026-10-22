import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Atom, Upload, Download, ChevronRight, RotateCcw, Play, Pause, Plus, Minus,
  Eye, SlidersHorizontal, X, FileText, Info, Hexagon, Layers3, ArrowUpRight,
  Check, MousePointer2, LoaderCircle, ShieldCheck, Moon, Sun, Save, Copy, Trash2, FolderOpen,
} from 'lucide-react';
import { InteractiveExportControl } from './components/InteractiveExportControl';
import { MoleculeViewer, type ViewerHandle } from './components/NativeMoleculeViewer';
import { OrbitalColorControl } from './components/OrbitalColorControl';
import { MolecularAppearanceControl } from './components/MolecularAppearanceControl';
import { RenderQualityControl } from './components/RenderQualityControl';
import { loadRenderQuality, saveRenderQuality } from './lib/render-quality-storage';
import { ProjectLibrary } from './components/ProjectLibrary';
import { DEFAULT_MOLECULE_APPEARANCE, normalizeMoleculeAppearance, readMoleculeAppearance, REPRESENTATIONS } from './lib/molecule-appearance';
import { formulaFor, parseCube, parseXYZ, type ParsedCube } from './lib/importers';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors } from './lib/orbital-colors';
import { loadOrbitalColors } from './lib/orbital-color-storage';
import { DEFAULT_DISPLAY_PREFERENCES, loadDisplayPreferences } from './lib/display-preferences';
import { applyMoleculeViewPreferences, loadMoleculeViewPreferences, moleculeViewPreferences, saveMoleculeViewPreferences } from './lib/molecule-view-preferences';
import { loadDemoOrbital, loadDemoSelection, loadRememberedDemo, saveDemoSelection } from './lib/demo-selection-storage';
import { cameraKeyForStructure } from './lib/camera-storage';
import { loadOrbitalSurfacePreferences, restoreOrbitalSurfacePreferences, saveOrbitalSurfacePreferences } from './lib/orbital-surface-storage';
import { assetURL, createDemoLoader, DEMOS, demoManifestURL, orbitalKind } from './lib/demos';
import { MAX_PROJECT_BYTES, parseProject, projectFileName, serializeProject, type ProjectSnapshot } from './lib/project';
import { browserProjectName, savedProjectStore, type SavedProjectSummary } from './lib/saved-projects';
import { applyAppearanceConfig, configFileName, MAX_CONFIG_BYTES, parseAppearanceConfig, serializeAppearanceConfig } from './lib/appearance-config';
import { canonicalConfigContents, loadSavedConfigs, savedConfigName, saveSavedConfigs, SAVED_CONFIGS_STORAGE_KEY,
  uniqueSavedConfigName, upsertSavedConfig } from './lib/saved-configs';
import { chooseOpenFile, chooseProjectFile, downloadProject, ensureProjectWritePermission, isFilePickerCancellation,
  supportsOpenPicker, supportsSavePicker, writeProjectFile, type ProjectFileHandle } from './lib/project-files';
import type { CameraState } from './lib/camera-state';
import type { DemoManifest, DisplaySettings, Scene } from './types';
import './components/demo-selector.css';
import './components/project-controls.css';
import './components/png-export.css';
import './components/config-controls.css';
import './components/isovalue-slider.css';

const PNG_TRANSPARENCY_STORAGE_KEY = 'iboview-png-transparent-background-v1';
const PNG_SCALE_STORAGE_KEY = 'iboview-png-scale-v1';
const PNG_CROP_STORAGE_KEY = 'iboview-png-crop-transparent-v1';
const pngScaleValue = (value: string | null): 1 | 2 | 4 => value === '1' ? 1 : value === '2' ? 2 : 4;
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
  const [renderQuality, setRenderQuality] = useState(loadRenderQuality);
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
  const [transparentBackground, setTransparentBackground] = useState(() => {
    try { return localStorage.getItem(PNG_TRANSPARENCY_STORAGE_KEY) !== 'false'; }
    catch { return true; }
  });
  const [pngScale, setPngScale] = useState<1 | 2 | 4>(() => {
    try { return pngScaleValue(localStorage.getItem(PNG_SCALE_STORAGE_KEY)); }
    catch { return 4; }
  });
  const [cropTransparent, setCropTransparent] = useState(() => {
    try { return localStorage.getItem(PNG_CROP_STORAGE_KEY) === 'true'; }
    catch { return false; }
  });
  const [saving, setSaving] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [projectSaveError, setProjectSaveError] = useState('');
  const [browserProjectId, setBrowserProjectId] = useState<string>();
  const [savedProjects, setSavedProjects] = useState<SavedProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectLibraryBusy, setProjectLibraryBusy] = useState(false);
  const [projectLibraryError, setProjectLibraryError] = useState('');
  const [configName, setConfigName] = useState('My appearance');
  const [configBusy, setConfigBusy] = useState(false);
  const [savedConfigs, setSavedConfigs] = useState(() => loadSavedConfigs());
  const [selectedConfigName, setSelectedConfigName] = useState('');
  const [configError, setConfigError] = useState('');
  const [removeConfigName, setRemoveConfigName] = useState('');
  const [initialCamera, setInitialCamera] = useState<CameraState>();
  const input = useRef<HTMLInputElement>(null);
  const viewer = useRef<ViewerHandle>(null);
  const about = useRef<HTMLDialogElement>(null);
  const saveDialog = useRef<HTMLDialogElement>(null);
  const projectLibraryDialog = useRef<HTMLDialogElement>(null);
  const configDialog = useRef<HTMLDialogElement>(null);
  const removeConfigDialog = useRef<HTMLDialogElement>(null);
  const configInput = useRef<HTMLInputElement>(null);
  const projectHandle = useRef<ProjectFileHandle | undefined>(undefined);
  const embeddedDemo = useRef<{ manifest: DemoManifest; volumes: Record<string, ParsedCube>; key: string } | undefined>(undefined);
  const fileOperation = useRef(false);
  const request = useRef(0);
  const projectListRequest = useRef(0);
  const loadDemo = useRef(createDemoLoader());

  const refreshSavedProjects = useCallback(async () => {
    const ticket = ++projectListRequest.current;
    setProjectsLoading(true);
    setProjectLibraryError('');
    try {
      const projects = await savedProjectStore.list();
      if (ticket === projectListRequest.current) setSavedProjects(projects);
    } catch (cause) {
      if (ticket === projectListRequest.current) setProjectLibraryError(cause instanceof Error ? cause.message : 'Saved projects could not be loaded.');
    } finally {
      if (ticket === projectListRequest.current) setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSavedProjects();
    return () => { projectListRequest.current++; };
  }, [refreshSavedProjects]);

  function rememberSavedProject(project: SavedProjectSummary) {
    projectListRequest.current++;
    setProjectsLoading(false);
    setProjectLibraryError('');
    setSavedProjects(previous => [project, ...previous.filter(item => item.id !== project.id)]);
    setBrowserProjectId(project.id);
    setProjectName(project.name);
  }

  function restoreProject(project: ProjectSnapshot, name: string, key: string, id?: string, handle?: ProjectFileHandle) {
    embeddedDemo.current = project.manifest && project.volumes
      ? { manifest: project.manifest, volumes: project.volumes, key } : undefined;
    projectHandle.current = handle;
    setBrowserProjectId(id);
    setProjectName(name);
    setManifest(project.manifest);
    setInitialCamera(project.camera);
    setColors(project.colors);
    setSettings(project.settings);
    if (project.scene.volume) saveOrbitalSurfacePreferences(cameraKeyForStructure(project.scene.structure.atoms), project.settings);
    setTheme(project.theme);
    setScene({ ...project.scene, key });
    setRenderStatus('loading');
  }

  async function openSavedProject(id: string) {
    if (fileOperation.current) return;
    const ticket = ++request.current;
    fileOperation.current = true;
    setProjectLibraryBusy(true);
    setBusy(true);
    setProjectLibraryError('');
    setError('');
    setPendingId('');
    setPendingDemo('');
    try {
      const stored = await savedProjectStore.get(id);
      if (!stored) throw new Error('This project is no longer in this browser. Refresh the project list.');
      const project = parseProject(stored.contents);
      if (ticket !== request.current) return;
      restoreProject(project, stored.name, `browser-project-${ticket}`, stored.id);
      projectLibraryDialog.current?.close();
      setToast(`Opened “${stored.name}” from this browser.`);
    } catch (cause) {
      setProjectLibraryError(cause instanceof Error ? cause.message : 'The saved project could not be opened.');
    } finally {
      if (ticket === request.current) setBusy(false);
      setProjectLibraryBusy(false);
      fileOperation.current = false;
    }
  }

  async function deleteSavedProject(id: string) {
    if (fileOperation.current) return;
    fileOperation.current = true;
    setProjectLibraryBusy(true);
    setProjectLibraryError('');
    try {
      await savedProjectStore.remove(id);
      projectListRequest.current++;
      setProjectsLoading(false);
      setSavedProjects(previous => previous.filter(project => project.id !== id));
      if (browserProjectId === id) setBrowserProjectId(undefined);
      setToast('Removed the saved project. Your current view is still open.');
    } catch (cause) {
      setProjectLibraryError(cause instanceof Error ? cause.message : 'The saved project could not be removed.');
    } finally {
      setProjectLibraryBusy(false);
      fileOperation.current = false;
    }
  }

  const currentConfigContents = useMemo(() => {
    try { return canonicalConfigContents(serializeAppearanceConfig({ settings, colors, theme })); }
    catch { return ''; }
  }, [settings, colors, theme]);
  const matchingConfigs = savedConfigs.filter(config => config.contents === currentConfigContents);
  const selectedConfig = matchingConfigs.find(config => config.name === selectedConfigName) ?? matchingConfigs[0];
  const replacingConfig = savedConfigs.some(config => config.name === savedConfigName(configName));

  useEffect(() => {
    if (selectedConfig) {
      setSelectedConfigName(selectedConfig.name);
      setConfigName(selectedConfig.name);
    }
  }, [selectedConfig?.name]);

  useEffect(() => {
    const refreshConfigs = (event: StorageEvent) => {
      if (event.key === SAVED_CONFIGS_STORAGE_KEY || event.key === null) setSavedConfigs(loadSavedConfigs());
    };
    window.addEventListener('storage', refreshConfigs);
    return () => window.removeEventListener('storage', refreshConfigs);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17171c' : '#faf9f5');
    try { localStorage.setItem('iboview-theme', theme); } catch { /* Storage may be unavailable in private sessions. */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(PNG_TRANSPARENCY_STORAGE_KEY, String(transparentBackground)); }
    catch { /* Keep export usable when browser storage is unavailable. */ }
  }, [transparentBackground]);

  useEffect(() => {
    try { localStorage.setItem(PNG_SCALE_STORAGE_KEY, String(pngScale)); }
    catch { /* Keep export usable when browser storage is unavailable. */ }
  }, [pngScale]);

  useEffect(() => {
    try { localStorage.setItem(PNG_CROP_STORAGE_KEY, String(cropTransparent)); }
    catch { /* Keep export usable when browser storage is unavailable. */ }
  }, [cropTransparent]);

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
    if (fileOperation.current) return;
    const ticket = ++request.current;
    const rememberedOrbital = orbitalId ?? loadDemoOrbital(id);
    setBusy(true);
    setError('');
    setPendingId(rememberedOrbital ?? '');
    setPendingDemo(id);
    try {
      const embedded = embeddedDemo.current;
      if (embedded?.manifest.id === id && scene) {
        const chosen = embedded.manifest.orbitals.find(item => item.id === (orbitalId ?? scene.orbital?.id ?? embedded.manifest.defaultOrbitalId));
        if (!chosen || !embedded.volumes[chosen.id]) throw new Error('The project does not contain this orbital.');
        setScene({ ...scene, key: embedded.key, volume: embedded.volumes[chosen.id], orbital: chosen });
        setRenderStatus('loading');
        return;
      }
      const { manifest: data, orbital: chosen, structure, volume } = orbitalId === undefined
        ? await loadRememberedDemo(loadDemo.current, { demoId: id, orbitalId: rememberedOrbital })
        : await loadDemo.current(id, orbitalId);
      if (ticket !== request.current) return;
      if (scene?.kind !== 'demo' || manifest?.id !== id) {
        projectHandle.current = undefined;
        embeddedDemo.current = undefined;
        setBrowserProjectId(undefined);
        setProjectName('');
        setInitialCamera(undefined);
      }
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

  async function importFile(file?: File, handle?: ProjectFileHandle, fromPicker = false) {
    if (!file || (fileOperation.current && !fromPicker)) return;
    fileOperation.current = true;
    const ticket = ++request.current;
    setBusy(true);
    setError('');
    setPendingId('');
    setPendingDemo('');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (extension === 'json') {
        if (file.size > MAX_PROJECT_BYTES) throw new Error('This project is too large to open. The limit is 200 MB.');
        const contents = await file.text();
        const project = parseProject(contents);
        if (ticket !== request.current) return;
        restoreProject(project, file.name, `project-${ticket}`, undefined, handle);
        try {
          const name = browserProjectName(file.name);
          const byteLength = new TextEncoder().encode(contents).byteLength;
          const projects = await savedProjectStore.list();
          let duplicate: SavedProjectSummary | undefined;
          for (const candidate of projects.filter(item => item.name === name && item.byteLength === byteLength)) {
            if ((await savedProjectStore.get(candidate.id))?.contents === contents) { duplicate = candidate; break; }
          }
          const stored = duplicate ?? await savedProjectStore.save({ name, contents,
            formula: project.scene.formula, kind: project.scene.kind,
            orbitalCount: project.manifest?.orbitals.length ?? (project.scene.volume ? 1 : 0) });
          if (ticket === request.current) {
            rememberSavedProject(stored);
            setToast(`Opened “${stored.name}” and added it to Projects.`);
          }
        } catch (cause) {
          setError(`Project opened, but could not be saved in this browser. ${cause instanceof Error ? cause.message : 'Browser storage is unavailable.'}`);
        }
        return;
      }
      if (file.size > 35 * 1024 * 1024) throw new Error('This preview supports molecular files up to 35 MB. Use a smaller Cube grid.');
      if (!['cube', 'cub', 'xyz'].includes(extension ?? '')) throw new Error('Choose an IboView project (.iboview.json), Gaussian Cube (.cube, .cub) or XYZ (.xyz) file.');
      const text = await file.text();
      const volume = extension === 'xyz' ? undefined : parseCube(text);
      const structure = volume ?? parseXYZ(text);
      if (ticket !== request.current) return;
      projectHandle.current = undefined;
      embeddedDemo.current = undefined;
      setBrowserProjectId(undefined);
      setProjectName('');
      setManifest(undefined);
      setInitialCamera(undefined);
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
      if (!fromPicker) fileOperation.current = false;
      if (input.current) input.current.value = '';
    }
  }

  async function openFile() {
    if (fileOperation.current) return;
    if (!supportsOpenPicker()) { input.current?.click(); return; }
    fileOperation.current = true;
    try {
      const { file, handle } = await chooseOpenFile();
      await importFile(file, handle, true);
    } catch (cause) {
      if (!isFilePickerCancellation(cause)) setError(cause instanceof Error ? cause.message : 'This file could not be opened.');
    } finally { fileOperation.current = false; }
  }

  function projectSnapshot(): ProjectSnapshot {
    const camera = viewer.current?.getCameraState();
    if (!scene || !camera) throw new Error('The view is not ready to save. Wait for the molecule to finish rendering.');
    return { scene, settings: viewerSettings, colors, camera, theme, manifest: scene.kind === 'demo' ? manifest : undefined };
  }

  async function projectContents(snapshot: ProjectSnapshot) {
    const existingDemo = embeddedDemo.current;
    const volumes: Record<string, ParsedCube> = Object.create(null);
    if (snapshot.manifest) {
      for (const orbital of snapshot.manifest.orbitals) {
        volumes[orbital.id] = existingDemo?.volumes[orbital.id]
          ?? (orbital.id === snapshot.scene.orbital?.id ? snapshot.scene.volume : undefined)
          ?? (await loadDemo.current(snapshot.manifest.id, orbital.id)).volume;
      }
    }
    return { contents: serializeProject({ ...snapshot, volumes: snapshot.manifest ? volumes : undefined }), volumes };
  }

  async function saveProject(asNew = false, name?: string) {
    if (!scene || busy || renderStatus !== 'ready' || fileOperation.current) return;
    if (name === undefined && (asNew || !browserProjectId)) {
      setSaveName(`${browserProjectName(projectName || scene.name)}${asNew && browserProjectId ? ' copy' : ''}`);
      setSaveAsNew(asNew);
      setProjectSaveError('');
      saveDialog.current?.showModal();
      return;
    }
    fileOperation.current = true;
    setSaving(true);
    setError('');
    setProjectSaveError('');
    try {
      const snapshot = projectSnapshot();
      const { contents, volumes } = await projectContents(snapshot);
      const stored = await savedProjectStore.save({ id: asNew ? undefined : browserProjectId,
        name: browserProjectName(name || projectName || scene.name), contents,
        formula: snapshot.scene.formula, kind: snapshot.scene.kind,
        orbitalCount: snapshot.manifest?.orbitals.length ?? (snapshot.scene.volume ? 1 : 0) });
      rememberSavedProject(stored);
      if (snapshot.manifest) embeddedDemo.current = { manifest: snapshot.manifest, volumes, key: snapshot.scene.key };
      if (asNew) projectHandle.current = undefined;
      saveDialog.current?.close();
      setToast(`Saved “${stored.name}” in this browser.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The project could not be saved in this browser.';
      if (saveDialog.current?.open) setProjectSaveError(message);
      else setError(message);
    } finally {
      fileOperation.current = false;
      setSaving(false);
    }
  }

  async function saveProjectFile(asNew = false, downloadName?: string) {
    if (!scene || busy || renderStatus !== 'ready' || fileOperation.current) return;
    const suggestedName = projectFileName(downloadName || projectName || scene.name);
    fileOperation.current = true;
    setSaving(true);
    setError('');
    setProjectSaveError('');
    try {
      const snapshot = projectSnapshot();
      let handle = asNew ? undefined : projectHandle.current;
      if (supportsSavePicker()) {
        if (handle) await ensureProjectWritePermission(handle);
        else handle = await chooseProjectFile(suggestedName);
      }
      const { contents } = await projectContents(snapshot);
      if (handle) {
        await writeProjectFile(handle, contents);
        projectHandle.current = handle;
        if (!browserProjectId) setProjectName(handle.name);
        setToast(`Saved ${handle.name}.`);
      } else {
        const name = projectFileName(downloadName ?? suggestedName);
        downloadProject(contents, name);
        if (!browserProjectId) setProjectName(name);
        setToast(`Download requested: ${name}.`);
      }
      saveDialog.current?.close();
    } catch (cause) {
      if (isFilePickerCancellation(cause)) setToast('Save canceled.');
      else {
        const message = cause instanceof Error ? cause.message : 'The project file could not be saved.';
        if (saveDialog.current?.open) setProjectSaveError(message);
        else setError(message);
      }
    } finally {
      fileOperation.current = false;
      setSaving(false);
    }
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      if (saveDialog.current?.open || projectLibraryDialog.current?.open || configDialog.current?.open || removeConfigDialog.current?.open || about.current?.open) return;
      event.preventDefault();
      void saveProject(event.shiftKey);
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  function saveConfig(downloadOnly = false) {
    if (fileOperation.current) return;
    setConfigError('');
    try {
      const contents = serializeAppearanceConfig({ settings, colors, theme });
      const name = savedConfigName(configName);
      if (downloadOnly) {
        downloadProject(contents, configFileName(name));
        setToast(`Config download requested: ${configFileName(name)}.`);
      } else {
        const next = upsertSavedConfig(loadSavedConfigs(), { name, contents });
        saveSavedConfigs(next);
        setSavedConfigs(next);
        setSelectedConfigName(name);
        setToast(`Saved “${name}” in this browser.`);
      }
      setConfigName(name);
      configDialog.current?.close();
    } catch (cause) {
      setConfigError(cause instanceof Error ? cause.message : 'The appearance config could not be saved.');
    }
  }

  function selectConfig(name: string) {
    if (fileOperation.current) return;
    const entry = savedConfigs.find(config => config.name === name);
    if (!entry) return;
    setError('');
    try {
      const config = parseAppearanceConfig(entry.contents);
      setSettings(previous => applyAppearanceConfig(previous, config));
      setColors(config.colors);
      setTheme(config.theme);
      setSelectedConfigName(entry.name);
      setConfigName(entry.name);
      setToast(`Applied “${entry.name}”.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The saved config could not be applied.');
    }
  }

  function removeConfig() {
    try {
      const next = loadSavedConfigs().filter(config => config.name !== removeConfigName);
      saveSavedConfigs(next);
      setSavedConfigs(next);
      setToast(`Removed “${removeConfigName}” from this browser.`);
      removeConfigDialog.current?.close();
    } catch (cause) {
      setConfigError(cause instanceof Error ? cause.message : 'The saved config could not be removed.');
    }
  }

  async function loadConfig(file?: File) {
    if (!file || fileOperation.current) return;
    fileOperation.current = true;
    setConfigBusy(true);
    setError('');
    try {
      if (file.size > MAX_CONFIG_BYTES) throw new Error('Appearance configs must be 64 KB or smaller. Use Open file for a project.');
      const config = parseAppearanceConfig(await file.text());
      setSettings(previous => applyAppearanceConfig(previous, config));
      setColors(config.colors);
      setTheme(config.theme);
      const contents = canonicalConfigContents(serializeAppearanceConfig({
        settings: applyAppearanceConfig(settings, config), colors: config.colors, theme: config.theme,
      }));
      const existing = loadSavedConfigs();
      const baseName = savedConfigName(file.name);
      const duplicate = existing.find(entry => entry.name === baseName && entry.contents === contents)
        ?? existing.find(entry => entry.contents === contents);
      const name = duplicate?.name ?? uniqueSavedConfigName(existing, baseName);
      setConfigName(name);
      try {
        const next = upsertSavedConfig(existing, { name, contents });
        saveSavedConfigs(next);
        setSavedConfigs(next);
        setSelectedConfigName(name);
        setToast(`Applied “${name}” and saved it in this browser.`);
      } catch (cause) {
        setError(`Appearance applied, but the config was not saved in this browser. ${cause instanceof Error ? cause.message : 'Browser storage is unavailable.'}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The appearance config could not be loaded.');
    } finally {
      fileOperation.current = false;
      setConfigBusy(false);
      if (configInput.current) configInput.current.value = '';
    }
  }

  function exportPNG() {
    setError('');
    try {
      const png = viewer.current?.exportPNG({ transparentBackground, scale: pngScale, cropTransparent });
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
      setToast(transparentBackground ? 'Transparent PNG download requested for the current view.' : 'PNG download requested for the current view.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The PNG could not be exported.');
    }
  }

  const isDemo = scene?.kind === 'demo';
  const peak = scene?.volume ? Math.max(Math.abs(scene.volume.range[0]), Math.abs(scene.volume.range[1])) : 1;
  const isoMax = isDemo ? 0.12 : importedRange(peak).max;
  const isoMin = isDemo ? manifest?.isovalueMin ?? 0.015 : importedRange(peak).min;
  const isoPosition = Math.max(0, Math.min(1, (isoMax - settings.isovalue) / (isoMax - isoMin)));
  const noSurface = hasVolume && settings.isovalue > peak;
  const ready = renderStatus === 'ready' && !busy && !configBusy;
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
          <button className="button secondary" aria-label="Open saved projects" disabled={saving || busy || configBusy || projectLibraryBusy}
            onClick={() => { projectLibraryDialog.current?.showModal(); void refreshSavedProjects(); }}><FolderOpen size={16} />Projects{savedProjects.length > 0 && <span className="project-count">{savedProjects.length}</span>}</button>
          <button className="button secondary" disabled={!ready || saving} onClick={() => void saveProject()} title="Save Project (⌘/Ctrl+S)">{saving ? <LoaderCircle size={16} className="loading-spin" /> : <Save size={16} />}{saving ? 'Saving…' : 'Save Project'}</button>
          <button className="button secondary" disabled={!ready || saving} onClick={() => void saveProject(true)} title="Save As (⌘/Ctrl+Shift+S)"><Copy size={16} />Save As</button>
          <InteractiveExportControl disabled={!ready} getView={() => viewer.current?.getInteractiveView()} />
          <div className="png-export-control" role="group" aria-label="PNG export">
            <button className="button secondary" disabled={!ready} onClick={exportPNG}><Download size={16} />Export PNG</button>
            <label className="png-export-resolution">Resolution
              <select aria-label="PNG resolution" value={pngScale} onChange={event => setPngScale(pngScaleValue(event.target.value))}
                title="Multiply the current view's pixel width and height">
                <option value="1">1×</option><option value="2">2×</option><option value="4">4×</option>
              </select>
            </label>
            <label className="png-export-option"><input type="checkbox" checked={transparentBackground}
              onChange={event => setTransparentBackground(event.target.checked)} />Transparent background</label>
            <label className="png-export-option" title="Requires Transparent background; removes only fully transparent margins">
              <input type="checkbox" checked={cropTransparent} disabled={!transparentBackground}
                onChange={event => setCropTransparent(event.target.checked)} />Crop transparent margins</label>
          </div>
          <button className="button primary" disabled={saving || busy || configBusy} onClick={() => void openFile()}><Upload size={16} />Open file</button>
          <input ref={input} className="visually-hidden" type="file" accept=".xyz,.cube,.cub,.json" aria-label="Open molecular file or project" onChange={event => void importFile(event.target.files?.[0])} />
        </div>
      </section>

      {projectName && <div className="project-file-line"><FileText size={13} /><span title={projectName}>{projectName}</span>{browserProjectId && <small>Browser project</small>}<button disabled={!ready || saving} onClick={() => void saveProjectFile()}><Download size={12} />{projectHandle.current ? 'Save file' : 'Export project file'}</button></div>}

      {error && <div className="error-banner" role="alert"><Info size={17} /><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}

      <div className="workspace">
        <aside className="library-panel panel" aria-label="Molecule and orbitals">
          <div className="panel-label"><Layers3 size={15} /><span>EXPLORER</span></div>
          <div className="demo-selector">
            <label htmlFor="demo-example">Demo example <span>{DEMOS.length} examples</span></label>
            <select id="demo-example" value={selectedDemo} aria-describedby="demo-detail" disabled={saving || configBusy}
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
              title={orbital.description} disabled={saving || configBusy} aria-pressed={scene?.orbital?.id === orbital.id} onClick={() => void showDemo(manifest.id, orbital.id)}>
              <span className={`orbital-glyph ${orbital.label.startsWith('σ') ? 'sigma' : ''}`} aria-hidden="true"><i /><i /></span>
              <span className="orbital-copy"><strong>{orbital.label}</strong><small>{orbitalKind(orbital)}<span>{orbital.occupation} electrons</span></small></span>
              {pendingId === orbital.id ? <LoaderCircle size={15} className="loading-spin" /> : scene?.orbital?.id === orbital.id ? <Eye size={15} /> : null}
            </button>)}
            {scene && !isDemo && <div className="imported-item"><FileText size={20} /><div><strong>{hasVolume ? 'Scalar field' : 'Molecular geometry'}</strong><p>{hasVolume ? 'One dataset · Cube' : 'XYZ · coordinates in Å'}</p></div></div>}
          </div>
          <div className="library-bottom">
            <div className="hint-card"><Atom size={18} /><p>{isDemo || !scene ? 'One orbital, two phases. The colors show the sign of the wavefunction, not charge.' : hasVolume ? 'Colors show positive and negative field values. Field identity and units come from your calculation.' : 'XYZ contains geometry only. Open a Cube file to display a volumetric field.'}</p></div>
            <button className="demo-link" disabled={saving || configBusy} onClick={() => void showDemo(manifest?.id)}><RotateCcw size={14} />Reload demo<ArrowUpRight size={15} /></button>
          </div>
        </aside>

        <section className="viewport-panel panel" aria-label="Molecular viewer" data-render-state={renderStatus}>
          <div className="viewport-header"><div className="viewport-title"><span className="tiny-dot" /><strong>IboView renderer</strong></div>
            <div className="viewport-render-options"><span className="viewport-mode">{REPRESENTATIONS.find(item => item.id === settings.style)?.name}<span className="subtle-separator">/</span>Orthographic</span><RenderQualityControl value={renderQuality} disabled={busy || saving} onChange={value => { setRenderQuality(value); saveRenderQuality(value); }} /></div></div>
          <div className="viewport-stage">
            <MoleculeViewer ref={viewer} renderQuality={renderQuality} scene={scene} settings={viewerSettings} theme={theme} initialCamera={initialCamera} onStatus={onRenderStatus} />
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
          <div className="saved-config-control">
            <label htmlFor="saved-config">Saved configs</label>
            <div className="saved-config-row">
              <select id="saved-config" value={selectedConfig?.name ?? ''} disabled={busy || saving || configBusy || !savedConfigs.length}
                onChange={event => selectConfig(event.target.value)}>
                <option value="" disabled>{savedConfigs.length ? 'Custom appearance' : 'No saved configs yet'}</option>
                {savedConfigs.map(config => <option key={config.name} value={config.name}>{config.name}</option>)}
              </select>
              <button className="icon-button" disabled={!selectedConfig || busy || saving || configBusy} aria-label="Remove saved config" title="Remove saved config"
                onClick={() => { setRemoveConfigName(selectedConfig!.name); setConfigError(''); removeConfigDialog.current?.showModal(); }}><Trash2 size={15} /></button>
            </div>
          </div>
          <div className="config-controls" role="group" aria-label="Appearance configs">
            <button className="button secondary" disabled={busy || saving || configBusy} onClick={() => { setConfigName(selectedConfig?.name ?? configName); setConfigError(''); configDialog.current?.showModal(); }}><Save size={13} />Save Config</button>
            <button className="button secondary" disabled={busy || saving || configBusy} onClick={() => configInput.current?.click()}><Upload size={13} />{configBusy ? 'Loading…' : 'Load Config'}</button>
            <input ref={configInput} className="visually-hidden" type="file" accept=".json" aria-label="Load appearance config" onChange={event => void loadConfig(event.target.files?.[0])} />
          </div>
          <p className="config-caption">Saved in this browser. Switch in any project.</p>
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
              <input id="isovalue" type="range" dir="rtl" style={{ '--isovalue-position': isoPosition } as CSSProperties} min={isoMin} max={isoMax} step={isDemo ? 0.001 : 'any'} value={settings.isovalue} disabled={!hasVolume || !settings.surface} onChange={event => update('isovalue', Number(event.target.value))} />
              <div className="range-labels"><span>Compact</span><span>Diffuse</span></div>
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
    <dialog ref={configDialog} className="about-dialog save-dialog" aria-labelledby="save-config-title">
      <form onSubmit={event => { event.preventDefault(); saveConfig(); }}>
        <h2 id="save-config-title">Save appearance config</h2>
        <p>Keep your colors, sizes, materials, opacity, labels and theme in the Saved configs menu for any project.</p>
        <label htmlFor="config-file-name">Config name</label>
        <input id="config-file-name" value={configName} onChange={event => setConfigName(event.target.value)} required maxLength={180} autoFocus />
        <p className="save-download-note">{replacingConfig ? `Saving will replace “${savedConfigName(configName)}” in this browser.` : 'Save in this browser, or download a config file to use elsewhere.'}</p>
        {configError && <p className="config-error" role="alert">{configError}</p>}
        <div className="save-dialog-actions config-dialog-actions"><button type="button" className="button secondary" onClick={() => configDialog.current?.close()}>Cancel</button><button type="button" className="button secondary" disabled={!configName.trim()} onClick={() => saveConfig(true)}><Download size={14} />Download file</button><button type="submit" className="button primary" disabled={!configName.trim()}><Save size={14} />{replacingConfig ? 'Update config' : 'Save to browser'}</button></div>
      </form>
    </dialog>
    <dialog ref={removeConfigDialog} className="about-dialog save-dialog" aria-labelledby="remove-config-title">
      <form onSubmit={event => { event.preventDefault(); removeConfig(); }}>
        <h2 id="remove-config-title">Remove saved config?</h2>
        <p>Remove “{removeConfigName}” from this browser? Your current appearance will stay as it is.</p>
        {configError && <p className="config-error" role="alert">{configError}</p>}
        <div className="save-dialog-actions"><button type="button" className="button secondary" onClick={() => removeConfigDialog.current?.close()}>Cancel</button><button type="submit" className="button primary"><Trash2 size={14} />Remove config</button></div>
      </form>
    </dialog>
    <dialog ref={saveDialog} className="about-dialog save-dialog" aria-labelledby="save-project-title" onCancel={event => { if (saving) event.preventDefault(); }}>
      <form onSubmit={event => { event.preventDefault(); void saveProject(saveAsNew, saveName); }}>
        <h2 id="save-project-title">{saveAsNew ? 'Save project as' : 'Save project'}</h2>
        <p>Keep molecular data, all orbitals, appearance and your view together. Open it again from Projects.</p>
        <label htmlFor="project-file-name">Project name</label>
        <input id="project-file-name" value={saveName} onChange={event => setSaveName(event.target.value)} required maxLength={180} disabled={saving} autoFocus />
        <p className="save-download-note">{saveAsNew ? 'Save a separate copy in this browser. Your original project stays in the list.' : 'Save in this browser without downloading a file.'} Use a project file for a backup or another browser.</p>
        {projectSaveError && <p className="project-save-error" role="alert">{projectSaveError}</p>}
        <div className="save-dialog-actions project-save-actions"><button type="button" className="button secondary" disabled={saving} onClick={() => saveDialog.current?.close()}>Cancel</button><button type="button" className="button secondary" disabled={saving || !saveName.trim()} onClick={() => void saveProjectFile(true, saveName)}><Download size={14} />{supportsSavePicker() ? 'Save file as…' : 'Download file'}</button><button type="submit" className="button primary" disabled={saving || !saveName.trim()}>{saving ? <LoaderCircle size={14} className="loading-spin" /> : <Save size={14} />}{saving ? 'Saving…' : 'Save to browser'}</button></div>
      </form>
    </dialog>
    <dialog ref={projectLibraryDialog} className="about-dialog project-library-dialog" aria-labelledby="project-library-title" onCancel={event => { if (projectLibraryBusy) event.preventDefault(); }}>
      <ProjectLibrary projects={savedProjects} activeId={browserProjectId} loading={projectsLoading} busy={projectLibraryBusy}
        error={projectLibraryError} onOpen={id => void openSavedProject(id)} onDelete={id => void deleteSavedProject(id)}
        onRefresh={() => void refreshSavedProjects()} onClose={() => projectLibraryDialog.current?.close()} />
    </dialog>
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

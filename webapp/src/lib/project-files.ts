interface ProjectWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

export interface ProjectFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<ProjectWritable>;
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface ProjectFilePickers {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: FilePickerType[];
  }) => Promise<ProjectFileHandle>;
  showOpenFilePicker?: (options: {
    multiple: boolean;
    types: FilePickerType[];
  }) => Promise<ProjectFileHandle[]>;
}

function filePickers(): ProjectFilePickers {
  return typeof window === 'undefined' ? {} : window as Window & ProjectFilePickers;
}

export function supportsSavePicker(): boolean {
  return typeof filePickers().showSaveFilePicker === 'function';
}

export function supportsOpenPicker(): boolean {
  return typeof filePickers().showOpenFilePicker === 'function';
}

export async function chooseProjectFile(suggestedName = 'project.iboview.json'): Promise<ProjectFileHandle> {
  const pickers = filePickers();
  if (!pickers.showSaveFilePicker) throw new Error('This browser does not support choosing a save location.');
  return pickers.showSaveFilePicker({
    suggestedName,
    types: [{ description: 'IboView project', accept: { 'application/json': ['.json'] } }],
  });
}

export async function chooseOpenFile(): Promise<{ file: File; handle: ProjectFileHandle }> {
  const pickers = filePickers();
  if (!pickers.showOpenFilePicker) throw new Error('This browser does not support the file picker.');
  const [handle] = await pickers.showOpenFilePicker({
    multiple: false,
    types: [{
      description: 'IboView projects and molecular data',
      accept: { 'application/json': ['.json'], 'text/plain': ['.xyz', '.cube', '.cub', '.cif', '.vasp', '.poscar'] },
    }],
  });
  if (!handle) throw new DOMException('No file selected.', 'AbortError');
  return { file: await handle.getFile(), handle };
}

export async function ensureProjectWritePermission(handle: ProjectFileHandle): Promise<void> {
  if (!handle.queryPermission && !handle.requestPermission) return;
  const options = { mode: 'readwrite' as const };
  if (await handle.queryPermission?.(options) === 'granted') return;
  if (await handle.requestPermission?.(options) === 'granted') return;
  throw new Error('Write permission was denied. Use Save As to choose a writable project file.');
}

export async function writeProjectFile(handle: ProjectFileHandle, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([contents], { type: 'application/json' }));
    await writable.close();
  } catch (error) {
    try { await writable.abort(); } catch { /* Keep the original write error. */ }
    throw error;
  }
}

export function downloadProject(contents: string, name: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function isFilePickerCancellation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

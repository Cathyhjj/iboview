import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseOpenFile, chooseProjectFile, downloadProject, ensureProjectWritePermission,
  isFilePickerCancellation, supportsOpenPicker, supportsSavePicker, writeProjectFile,
  type ProjectFileHandle,
} from '../src/lib/project-files';

function fileHandle() {
  const file = new File(['{}'], 'molecule.iboview.json', { type: 'application/json' });
  const writable = { write: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined) };
  const handle = { name: file.name, getFile: vi.fn().mockResolvedValue(file), createWritable: vi.fn().mockResolvedValue(writable) };
  return { file, writable, handle };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('native project file pickers', () => {
  it('detects each picker independently and tolerates non-browser environments', () => {
    expect(supportsSavePicker()).toBe(false);
    expect(supportsOpenPicker()).toBe(false);
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn() });
    expect(supportsSavePicker()).toBe(true);
    expect(supportsOpenPicker()).toBe(false);
    vi.stubGlobal('window', { showOpenFilePicker: vi.fn() });
    expect(supportsSavePicker()).toBe(false);
    expect(supportsOpenPicker()).toBe(true);
  });

  it('suggests the project filename and JSON extension while preserving the picker receiver', async () => {
    const { handle } = fileHandle();
    const browser = {
      showSaveFilePicker: vi.fn(function (this: unknown) {
        expect(this).toBe(browser);
        return Promise.resolve(handle);
      }),
    };
    vi.stubGlobal('window', browser);
    expect(await chooseProjectFile('benzene.iboview.json')).toBe(handle);
    expect(browser.showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'benzene.iboview.json',
      types: [{ description: 'IboView project', accept: { 'application/json': ['.json'] } }],
    });
  });

  it('opens supported molecular files with a reusable handle', async () => {
    const { file, handle } = fileHandle();
    const picker = vi.fn().mockResolvedValue([handle]);
    vi.stubGlobal('window', { showOpenFilePicker: picker });
    expect(await chooseOpenFile()).toEqual({ file, handle });
    expect(handle.getFile).toHaveBeenCalledOnce();
    expect(picker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: 'IboView projects and molecular data', accept: { 'application/json': ['.json'], 'text/plain': ['.xyz', '.cube', '.cub', '.cif', '.vasp', '.poscar'] } }],
    });
  });

  it.each(['AbortError', 'NotAllowedError', 'SecurityError'])('preserves %s errors for the caller', async name => {
    const error = new DOMException('Picker failed', name);
    vi.stubGlobal('window', { showSaveFilePicker: vi.fn().mockRejectedValue(error), showOpenFilePicker: vi.fn().mockRejectedValue(error) });
    await expect(chooseProjectFile()).rejects.toBe(error);
    await expect(chooseOpenFile()).rejects.toBe(error);
    expect(isFilePickerCancellation(error)).toBe(name === 'AbortError');
  });

  it('does not treat unrelated errors or empty values as cancellations', () => {
    for (const value of [new Error('Aborted'), null, undefined, 'AbortError', { name: 'NotAllowedError' }]) {
      expect(isFilePickerCancellation(value)).toBe(false);
    }
  });

  it('reports an empty picker result as cancellation and preserves file-read failures', async () => {
    const { handle } = fileHandle();
    vi.stubGlobal('window', { showOpenFilePicker: vi.fn().mockResolvedValue([]) });
    await expect(chooseOpenFile()).rejects.toMatchObject({ name: 'AbortError' });
    const error = new Error('File no longer exists');
    handle.getFile.mockRejectedValue(error);
    vi.stubGlobal('window', { showOpenFilePicker: vi.fn().mockResolvedValue([handle]) });
    await expect(chooseOpenFile()).rejects.toBe(error);
  });
});

describe('project write permission', () => {
  it('supports handles without permission methods', async () => {
    await expect(ensureProjectWritePermission(fileHandle().handle)).resolves.toBeUndefined();
  });

  it('reuses an existing grant without prompting', async () => {
    const handle = { ...fileHandle().handle, queryPermission: vi.fn().mockResolvedValue('granted'), requestPermission: vi.fn() };
    await ensureProjectWritePermission(handle);
    expect(handle.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it('requests readwrite access for an opened file', async () => {
    const handle = { ...fileHandle().handle, queryPermission: vi.fn().mockResolvedValue('prompt'), requestPermission: vi.fn().mockResolvedValue('granted') };
    await ensureProjectWritePermission(handle);
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('reports denied access without attempting a write', async () => {
    const handle = { ...fileHandle().handle, queryPermission: vi.fn().mockResolvedValue('prompt'), requestPermission: vi.fn().mockResolvedValue('denied') };
    await expect(ensureProjectWritePermission(handle)).rejects.toThrow('Use Save As');
    expect(handle.createWritable).not.toHaveBeenCalled();
  });
});

describe('native project writes', () => {
  it('writes the complete JSON blob before closing the file', async () => {
    const { handle, writable } = fileHandle();
    await writeProjectFile(handle, '{"title":"Benzene"}');
    expect(handle.createWritable).toHaveBeenCalledOnce();
    const blob = writable.write.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('{"title":"Benzene"}');
    expect(writable.write.mock.invocationCallOrder[0]).toBeLessThan(writable.close.mock.invocationCallOrder[0]);
    expect(writable.abort).not.toHaveBeenCalled();
  });

  it.each(['write', 'close'] as const)('aborts and preserves the original error when %s fails', async step => {
    const { handle, writable } = fileHandle();
    const error = new Error('Disk full');
    writable[step].mockRejectedValue(error);
    writable.abort.mockRejectedValue(new Error('Already closed'));
    await expect(writeProjectFile(handle, '{}')).rejects.toBe(error);
    expect(writable.abort).toHaveBeenCalledOnce();
    if (step === 'write') expect(writable.close).not.toHaveBeenCalled();
  });

  it('preserves permission errors when creating a writable stream fails', async () => {
    const { handle, writable } = fileHandle();
    const error = new DOMException('Permission denied', 'NotAllowedError');
    handle.createWritable.mockRejectedValue(error);
    await expect(writeProjectFile(handle as ProjectFileHandle, '{}')).rejects.toBe(error);
    expect(writable.write).not.toHaveBeenCalled();
    expect(writable.abort).not.toHaveBeenCalled();
  });
});

describe('download fallback', () => {
  it.each([false, true])('removes the temporary link and delays URL cleanup (click failure: %s)', fails => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    if (fails) anchor.click.mockImplementation(() => { throw new Error('Download blocked'); });
    const document = { createElement: vi.fn().mockReturnValue(anchor), body: { appendChild: vi.fn() } };
    vi.stubGlobal('document', document);
    const createURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:project');
    const revokeURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const download = () => downloadProject('{"title":"Water"}', 'water.iboview.json');
    if (fails) expect(download).toThrow('Download blocked');
    else expect(download).not.toThrow();
    expect(createURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchor.href).toBe('blob:project');
    expect(anchor.download).toBe('water.iboview.json');
    expect(anchor.hidden).toBe(true);
    expect(document.body.appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeURL).toHaveBeenCalledExactlyOnceWith('blob:project');
  });
});

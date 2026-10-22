import { describe, expect, it, vi } from 'vitest';
import { DEMOS } from '../src/lib/demos';
import {
  DEMO_ORBITALS_STORAGE_KEY, DEMO_SELECTION_STORAGE_KEY, loadDemoOrbital,
  loadDemoSelection, loadRememberedDemo, saveDemoSelection,
} from '../src/lib/demo-selection-storage';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('last demo selection', () => {
  it.each(DEMOS)('restores $id and its selected orbital', demo => {
    const storage = memoryStorage();
    const selection = { demoId: demo.id, orbitalId: 'ibo-13' };
    saveDemoSelection(selection, storage);
    expect(DEMO_SELECTION_STORAGE_KEY).toBe('iboview-demo-selection-v1');
    expect(loadDemoSelection(storage)).toEqual(selection);
  });

  it('starts with the first demo when no selection is stored', () => {
    expect(loadDemoSelection(memoryStorage())).toEqual({ demoId: DEMOS[0].id });
  });

  it.each(['{broken', 'null', '[]', '42', '{"demoId":"unknown","orbitalId":"ibo-13"}'])
    ('ignores invalid stored selections %s', raw => {
      expect(loadDemoSelection({ getItem: () => raw })).toEqual({ demoId: DEMOS[0].id });
    });

  it.each([undefined, null, 42, '', 'x'.repeat(201)])('keeps a valid demo without an invalid orbital id %s', orbitalId => {
    const raw = JSON.stringify({ demoId: 'feco3no', orbitalId });
    expect(loadDemoSelection({ getItem: () => raw })).toEqual({ demoId: 'feco3no' });
  });

  it('saves only known demo selection identifiers', () => {
    const storage = memoryStorage();
    const selection = { demoId: 're2me8', orbitalId: 'ibo-08', fileContents: 'private file data' };
    saveDemoSelection(selection, storage);
    expect(JSON.parse(storage.getItem(DEMO_SELECTION_STORAGE_KEY)!))
      .toEqual({ demoId: 're2me8', orbitalId: 'ibo-08' });
    expect(JSON.parse(storage.getItem(DEMO_ORBITALS_STORAGE_KEY)!)).toEqual({ re2me8: 'ibo-08' });
    saveDemoSelection({ demoId: 'local-import', orbitalId: 'ibo-01' }, storage);
    expect(loadDemoSelection(storage)).toEqual({ demoId: 're2me8', orbitalId: 'ibo-08' });
  });

  it('tolerates blocked storage', () => {
    expect(loadDemoSelection({ getItem: () => { throw new Error('blocked'); } }))
      .toEqual({ demoId: DEMOS[0].id });
    expect(() => saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-01' },
      { getItem: () => null, setItem: () => { throw new Error('blocked'); } })).not.toThrow();
    expect(loadDemoSelection()).toEqual({ demoId: DEMOS[0].id });
    expect(() => saveDemoSelection({ demoId: 'feco3no' })).not.toThrow();
  });

  it('loads the remembered orbital directly when it is available', async () => {
    const result = { orbitalId: 'ibo-08' };
    const load = vi.fn(async () => result);
    await expect(loadRememberedDemo(load, { demoId: 're2me8', orbitalId: 'ibo-08' })).resolves.toBe(result);
    expect(load.mock.calls).toEqual([['re2me8', 'ibo-08']]);
  });

  it('falls back to the same demo default only when a remembered orbital was removed', async () => {
    const result = { orbitalId: 'default' };
    const load = vi.fn(async (_demoId: string, orbitalId?: string) => {
      if (orbitalId) throw new Error('This example does not contain the requested orbital.');
      return result;
    });
    await expect(loadRememberedDemo(load, { demoId: 'feco3no', orbitalId: 'removed' })).resolves.toBe(result);
    expect(load.mock.calls).toEqual([['feco3no', 'removed'], ['feco3no']]);
  });

  it.each(['Could not load manifest.json (503).', 'Invalid Cube data.', 'Graphics context interrupted.'])
    ('does not conceal failures: %s', async message => {
      const failure = new Error(message);
      const load = vi.fn(async () => { throw failure; });
      await expect(loadRememberedDemo(load, { demoId: 'feco3no', orbitalId: 'ibo-01' })).rejects.toBe(failure);
      expect(load).toHaveBeenCalledTimes(1);
    });

  it('reports an unavailable default orbital instead of retrying repeatedly', async () => {
    const failure = new Error('This example does not contain the requested orbital.');
    const load = vi.fn(async () => { throw failure; });
    await expect(loadRememberedDemo(load, { demoId: 'feco3no' })).rejects.toBe(failure);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reports a failed fallback request without another retry', async () => {
    const failure = new Error('Could not load orbital.cube (503).');
    const load = vi.fn(async (_demoId: string, orbitalId?: string) => {
      if (orbitalId) throw new Error('This example does not contain the requested orbital.');
      throw failure;
    });
    await expect(loadRememberedDemo(load, { demoId: 'feco3no', orbitalId: 'removed' })).rejects.toBe(failure);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('each demo remembers its own orbital', () => {
  it('restores A after switching A to B and preserves B when returning to A', () => {
    const storage = memoryStorage();
    saveDemoSelection({ demoId: 'benzene', orbitalId: 'ibo-13' }, storage);
    saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-02' }, storage);
    expect(DEMO_ORBITALS_STORAGE_KEY).toBe('iboview-demo-orbitals-v1');
    expect(loadDemoSelection(storage)).toEqual({ demoId: 'feco3no', orbitalId: 'ibo-02' });
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
    saveDemoSelection({ demoId: 'benzene', orbitalId: loadDemoOrbital('benzene', storage) }, storage);
    expect(loadDemoSelection(storage)).toEqual({ demoId: 'benzene', orbitalId: 'ibo-13' });
    expect(loadDemoOrbital('feco3no', storage)).toBe('ibo-02');
  });

  it('isolates equal orbital IDs and later updates across different demos', () => {
    const storage = memoryStorage();
    saveDemoSelection({ demoId: 'benzene', orbitalId: 'ibo-13' }, storage);
    saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-13' }, storage);
    saveDemoSelection({ demoId: 'benzene', orbitalId: 'ibo-19' }, storage);
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-19');
    expect(loadDemoOrbital('feco3no', storage)).toBe('ibo-13');
    expect(loadDemoOrbital('re2me8', storage)).toBeUndefined();
  });

  it('recovers an old latest selection before any migration is saved', () => {
    const storage = memoryStorage();
    storage.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify({ demoId: 'benzene', orbitalId: 'ibo-13' }));
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
    expect(loadDemoOrbital('feco3no', storage)).toBeUndefined();
    expect(storage.getItem(DEMO_ORBITALS_STORAGE_KEY)).toBeNull();
  });

  it('migrates the old molecule before saving the first selection of a new molecule', () => {
    const storage = memoryStorage();
    storage.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify({ demoId: 'benzene', orbitalId: 'ibo-13' }));
    saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-02' }, storage);
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
    expect(loadDemoOrbital('feco3no', storage)).toBe('ibo-02');
    expect(loadDemoSelection(storage)).toEqual({ demoId: 'feco3no', orbitalId: 'ibo-02' });
  });

  it('keeps an existing per-demo choice ahead of an older global record', () => {
    const storage = memoryStorage();
    storage.setItem(DEMO_ORBITALS_STORAGE_KEY, JSON.stringify({ benzene: 'ibo-19' }));
    storage.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify({ demoId: 'benzene', orbitalId: 'ibo-13' }));
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-19');
    saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-02' }, storage);
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-19');
  });

  it.each(['{broken', 'null', '[]', '42', '"ibo-13"'])
    ('falls back to a valid old record and repairs malformed map JSON: %s', raw => {
      const storage = memoryStorage();
      storage.setItem(DEMO_ORBITALS_STORAGE_KEY, raw);
      storage.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify({ demoId: 'benzene', orbitalId: 'ibo-13' }));
      expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
      saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-02' }, storage);
      expect(JSON.parse(storage.getItem(DEMO_ORBITALS_STORAGE_KEY)!))
        .toEqual({ benzene: 'ibo-13', feco3no: 'ibo-02' });
    });

  it('drops bad entries individually while preserving valid known demo IDs', () => {
    const storage = memoryStorage();
    storage.setItem(DEMO_ORBITALS_STORAGE_KEY, JSON.stringify({
      benzene: '', feco3no: null, re2me8: 'ibo-08', 'sn2-intermediate': { orbitalId: 'ibo-10' },
      unknown: 'ibo-20', fileContents: 'private file data',
    }));
    expect(loadDemoOrbital('benzene', storage)).toBeUndefined();
    expect(loadDemoOrbital('feco3no', storage)).toBeUndefined();
    expect(loadDemoOrbital('sn2-intermediate', storage)).toBeUndefined();
    expect(loadDemoOrbital('unknown', storage)).toBeUndefined();
    expect(loadDemoOrbital('re2me8', storage)).toBe('ibo-08');
    saveDemoSelection({ demoId: 'benzene', orbitalId: 'ibo-13' }, storage);
    expect(JSON.parse(storage.getItem(DEMO_ORBITALS_STORAGE_KEY)!))
      .toEqual({ re2me8: 'ibo-08', benzene: 'ibo-13' });
  });

  it.each([42, false, '', 'x'.repeat(201)])('falls back when the requested map entry is invalid: %s', orbitalId => {
    const storage = memoryStorage();
    storage.setItem(DEMO_ORBITALS_STORAGE_KEY, JSON.stringify({ benzene: orbitalId }));
    storage.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify({ demoId: 'benzene', orbitalId: 'ibo-13' }));
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
  });

  it('does not erase another saved orbital when only a demo ID is saved', () => {
    const storage = memoryStorage();
    saveDemoSelection({ demoId: 'benzene', orbitalId: 'ibo-13' }, storage);
    saveDemoSelection({ demoId: 'benzene' }, storage);
    expect(loadDemoSelection(storage)).toEqual({ demoId: 'benzene' });
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
  });

  it('does not save unknown demos or alter existing records', () => {
    const storage = memoryStorage();
    saveDemoSelection({ demoId: 'benzene', orbitalId: 'ibo-13' }, storage);
    const map = storage.getItem(DEMO_ORBITALS_STORAGE_KEY);
    const latest = storage.getItem(DEMO_SELECTION_STORAGE_KEY);
    saveDemoSelection({ demoId: 'local-file', orbitalId: 'ibo-02' }, storage);
    expect(storage.getItem(DEMO_ORBITALS_STORAGE_KEY)).toBe(map);
    expect(storage.getItem(DEMO_SELECTION_STORAGE_KEY)).toBe(latest);
  });

  it('keeps the old record when migration cannot be saved', () => {
    const storage = memoryStorage();
    storage.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify({ demoId: 'benzene', orbitalId: 'ibo-13' }));
    const blocked = { getItem: storage.getItem, setItem: (key: string, value: string) => {
      if (key === DEMO_ORBITALS_STORAGE_KEY) throw new Error('quota');
      storage.setItem(key, value);
    } };
    expect(() => saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-02' }, blocked)).not.toThrow();
    expect(loadDemoSelection(storage)).toEqual({ demoId: 'benzene', orbitalId: 'ibo-13' });
    expect(loadDemoOrbital('benzene', storage)).toBe('ibo-13');
  });

  it('tolerates blocked and unavailable storage', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(loadDemoOrbital('benzene', blocked)).toBeUndefined();
    expect(() => saveDemoSelection({ demoId: 'feco3no', orbitalId: 'ibo-02' }, blocked)).not.toThrow();
    expect(loadDemoOrbital('benzene')).toBeUndefined();
  });
});

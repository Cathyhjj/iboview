import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { MAX_PROJECT_BYTES } from '../src/lib/project';
import { browserProjectName, createSavedProjectStore, SAVED_PROJECTS_DATABASE_NAME } from '../src/lib/saved-projects';

// Exercise the size boundary without allocating a 200 MB fixture for each case.
vi.mock('../src/lib/project', () => ({ MAX_PROJECT_BYTES: 256 }));

const input = (name = 'Water', contents = '{"molecule":"H2O"}') => ({
  name, contents, formula: 'H2O', kind: 'xyz' as const, orbitalCount: 0,
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('browser project persistence', () => {
  it('saves a complete record and reopens it from another store instance', async () => {
    const factory = new IDBFactory();
    const store = createSavedProjectStore(factory);
    const summary = await store.save(input('  Water.iboview.json '));
    expect(summary).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      name: 'Water', createdAt: expect.any(Number), updatedAt: expect.any(Number),
      byteLength: new Blob([input().contents]).size, formula: 'H2O', kind: 'xyz', orbitalCount: 0,
    });
    expect(summary.updatedAt).toBe(summary.createdAt);
    const reopened = createSavedProjectStore(factory);
    expect(await reopened.list()).toEqual([summary]);
    expect(await reopened.get(summary.id)).toEqual({ ...summary, contents: input().contents });
  });

  it('lists only the metadata store without loading project contents', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const summary = await store.save(input());
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const records = await store.list();
    expect(transactions).toHaveBeenCalledExactlyOnceWith(['metadata'], 'readonly');
    expect(records).toEqual([summary]);
    expect(records[0]).not.toHaveProperty('contents');
  });

  it('updates by ID, preserves creation time, and creates an independent copy without an ID', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const first = await store.save(input());
    clock.mockReturnValue(2000);
    const updated = await store.save({ ...input('Renamed', 'updated data'), id: first.id, kind: 'cube', orbitalCount: 1 });
    expect(updated).toMatchObject({ id: first.id, name: 'Renamed', createdAt: 1000, updatedAt: 2000, kind: 'cube', orbitalCount: 1 });
    expect((await store.get(first.id))?.contents).toBe('updated data');
    clock.mockReturnValue(3000);
    const copied = await store.save(input('Renamed', 'independent copy'));
    expect(copied.id).not.toBe(first.id);
    expect(copied.createdAt).toBe(3000);
    expect(await store.list()).toEqual([copied, updated]);
    expect((await store.get(first.id))?.contents).toBe('updated data');
  });

  it('uses deterministic ID order when modification times are equal', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const store = createSavedProjectStore(new IDBFactory());
    const records = await Promise.all([store.save(input('A')), store.save(input('B')), store.save(input('C'))]);
    const expected = records.map(record => record.id).sort();
    expect((await store.list()).map(record => record.id)).toEqual(expected);
    expect((await store.list()).map(record => record.id)).toEqual(expected);
  });

  it('serializes concurrent updates and preserves the original creation time', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const first = await store.save(input());
    const [, last] = await Promise.all([
      store.save({ ...input('First update', 'first'), id: first.id }),
      store.save({ ...input('Last update', 'last'), id: first.id }),
    ]);
    expect(last.createdAt).toBe(first.createdAt);
    expect(await store.list()).toEqual([last]);
    expect(await store.get(first.id)).toEqual({ ...last, contents: 'last' });
  });

  it('removes metadata and contents together and handles an already-missing ID', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const summary = await store.save(input());
    await store.remove(summary.id);
    expect(await store.get(summary.id)).toBeUndefined();
    expect(await store.list()).toEqual([]);
    await expect(store.remove(summary.id)).resolves.toBeUndefined();
    await expect(store.save({ ...input(), id: summary.id })).rejects.toThrow(/no longer exists.*Save As/);
    expect(await store.list()).toEqual([]);
  });

  it('does not parse or rewrite the validated project contents supplied by the app', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const contents = 'The app owns project format validation.\n原样保留';
    const summary = await store.save(input('测试', contents));
    expect(summary.byteLength).toBe(new TextEncoder().encode(contents).byteLength);
    expect((await store.get(summary.id))?.contents).toBe(contents);
  });
});

describe('atomic project changes', () => {
  it('preserves the old metadata and contents if a replacement runs out of quota', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const original = await store.save(input());
    const oldRecord = await store.get(original.id);
    const put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      if (this.name === 'contents') throw new DOMException('Storage quota reached', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    await expect(store.save({ ...input('Replacement', 'new contents'), id: original.id })).rejects.toThrow(/storage is full/);
    failure.mockRestore();
    expect(await store.get(original.id)).toEqual(oldRecord);
    expect(await store.list()).toEqual([original]);
  });

  it('does not report success before a transaction commits, even after both writes succeed', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const original = await store.save(input());
    const oldRecord = await store.get(original.id);
    const put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key);
      if (this.name === 'contents') request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(store.save({ ...input('Replacement', 'new contents'), id: original.id })).rejects.toThrow(/could not complete/);
    failure.mockRestore();
    expect(await store.get(original.id)).toEqual(oldRecord);
    expect(await store.list()).toEqual([original]);
  });

  it('leaves no metadata-only project when a new save is aborted', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (value, key) {
      const request = put.call(this, value, key);
      if (this.name === 'contents') request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(store.save(input())).rejects.toThrow();
    failure.mockRestore();
    expect(await store.list()).toEqual([]);
  });

  it('retains both stores when deletion is aborted after its requests succeed', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    const original = await store.save(input());
    const oldRecord = await store.get(original.id);
    const remove = IDBObjectStore.prototype.delete;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (key) {
      const request = remove.call(this, key);
      if (this.name === 'contents') request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
    await expect(store.remove(original.id)).rejects.toThrow();
    failure.mockRestore();
    expect(await store.get(original.id)).toEqual(oldRecord);
    expect(await store.list()).toEqual([original]);
  });
});

describe('storage availability and validation', () => {
  it('rejects unavailable and denied storage instead of returning an empty library', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(createSavedProjectStore().list()).rejects.toThrow(/does not provide project storage/);
    const denied = { open: () => { throw new DOMException('Denied', 'SecurityError'); } } as unknown as IDBFactory;
    const store = createSavedProjectStore(denied);
    await expect(store.list()).rejects.toThrow(/unavailable or permission was denied/);
    await expect(store.save(input())).rejects.toThrow(/unavailable or permission was denied/);
  });

  it('reports an asynchronous opening failure and allows retrying the store', async () => {
    const factory = new IDBFactory();
    const open = factory.open.bind(factory);
    const failure = vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      const request = { error: new DOMException('Opening failed', 'UnknownError'), onerror: null as ((event: Event) => void) | null };
      queueMicrotask(() => request.onerror?.(new Event('error')));
      return request as unknown as IDBOpenDBRequest;
    });
    const store = createSavedProjectStore(factory);
    await expect(store.list()).rejects.toThrow(/could not complete/);
    failure.mockImplementation(open);
    expect(await store.list()).toEqual([]);
  });

  it('rejects blocked opening with an actionable message', async () => {
    const request = { onblocked: null as ((event: Event) => void) | null };
    const factory = {
      open: () => {
        queueMicrotask(() => request.onblocked?.(new Event('blocked')));
        return request;
      },
    } as unknown as IDBFactory;
    await expect(createSavedProjectStore(factory).list()).rejects.toThrow(/blocked.*Close or reload other tabs/);
  });

  it('closes its connection on version changes so another tab can upgrade', async () => {
    const factory = new IDBFactory();
    const store = createSavedProjectStore(factory);
    await store.save(input());
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(SAVED_PROJECTS_DATABASE_NAME, 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Upgrade was unexpectedly blocked'));
    });
    upgraded.close();
    await expect(store.list()).rejects.toThrow(/could not complete/);
  });

  it.each([
    { name: 42 }, { formula: null }, { formula: 'C'.repeat(2049) }, { kind: 'invalid' },
    { orbitalCount: -1 }, { orbitalCount: 1.2 }, { orbitalCount: Infinity }, { contents: '' },
    { contents: '  ' }, { contents: 42 }, { id: '' }, { id: '../project' },
  ])('rejects invalid metadata before writing: %j', async patch => {
    const store = createSavedProjectStore(new IDBFactory());
    await expect(store.save({ ...input(), ...patch } as Parameters<typeof store.save>[0])).rejects.toThrow();
    expect(await store.list()).toEqual([]);
  });

  it('enforces the UTF-8 byte limit as well as the string length limit', async () => {
    const store = createSavedProjectStore(new IDBFactory());
    await expect(store.save(input('ASCII', 'x'.repeat(MAX_PROJECT_BYTES + 1)))).rejects.toThrow(/200 MB/);
    await expect(store.save(input('UTF-8', '水'.repeat(Math.floor(MAX_PROJECT_BYTES / 3) + 1)))).rejects.toThrow(/200 MB/);
    const summary = await store.save(input('Boundary', 'x'.repeat(MAX_PROJECT_BYTES)));
    expect(summary.byteLength).toBe(MAX_PROJECT_BYTES);
    expect(await store.list()).toEqual([summary]);
  });
});

describe('browser project names', () => {
  it.each([
    ['  Benzene.iboview.json ', 'Benzene'], ['Water.xyz', 'Water'], ['Field.cube', 'Field'],
    ['Field.cub', 'Field'], ['Data.json', 'Data'], ['', 'Untitled project'],
    ['.iboview.json', 'Untitled project'], ['中文分子 🔬', '中文分子 🔬'],
    ['Style.iboview.json.iboview.json', 'Style'], ['Style.json .xyz ', 'Style'],
  ])('normalizes %s idempotently', (source, expected) => {
    expect(browserProjectName(source)).toBe(expected);
    expect(browserProjectName(expected)).toBe(expected);
  });

  it('limits Unicode names without splitting surrogate pairs or exposing an unstable suffix', () => {
    expect(browserProjectName('🔬'.repeat(130))).toBe('🔬'.repeat(120));
    const name = `${'a'.repeat(107)}.iboview.jsonmore`;
    const normalized = browserProjectName(name);
    expect(Array.from(normalized).length).toBeLessThanOrEqual(120);
    expect(browserProjectName(normalized)).toBe(normalized);
  });
});

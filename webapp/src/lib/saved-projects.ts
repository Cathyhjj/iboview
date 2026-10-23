import { MAX_PROJECT_BYTES } from './project';

export const SAVED_PROJECTS_DATABASE_NAME = 'iboview-saved-projects-v1';
const DATABASE_VERSION = 1;
const METADATA_STORE = 'metadata';
const CONTENTS_STORE = 'contents';

export interface SavedProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  byteLength: number;
  formula: string;
  kind: 'demo' | 'cube' | 'xyz' | 'crystal';
  orbitalCount: number;
}

export interface SavedProjectRecord extends SavedProjectSummary {
  contents: string;
}

interface SaveProjectInput {
  id?: string;
  name: string;
  contents: string;
  formula: string;
  kind: SavedProjectSummary['kind'];
  orbitalCount: number;
}

export function browserProjectName(name: string): string {
  let normalized = name.trim();
  for (;;) {
    const next = Array.from(normalized.replace(/(?:\.(?:iboview\.json|json|xyz|cube|cub)\s*)+$/i, '').trim())
      .slice(0, 120).join('').trim();
    if (next === normalized) return next || 'Untitled project';
    normalized = next;
  }
}

function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('Saved project ID is invalid.');
}

function validateMetadata(input: Pick<SaveProjectInput, 'name' | 'formula' | 'kind' | 'orbitalCount'>): void {
  if (typeof input.name !== 'string') throw new Error('Saved project name must be text.');
  if (typeof input.formula !== 'string' || input.formula.length > 2048) throw new Error('Saved project formula must be text up to 2048 characters.');
  if (!['demo', 'cube', 'xyz', 'crystal'].includes(input.kind)) throw new Error('Saved project type is invalid.');
  if (!Number.isSafeInteger(input.orbitalCount) || input.orbitalCount < 0) throw new Error('Saved project orbital count must be a nonnegative integer.');
}

function readSummary(value: unknown): SavedProjectSummary {
  if (!value || typeof value !== 'object') throw new Error('Saved project metadata is damaged.');
  const input = value as SavedProjectSummary;
  validId(input.id);
  validateMetadata(input);
  if (![input.createdAt, input.updatedAt, input.byteLength].every(number => Number.isSafeInteger(number) && number >= 0)
    || input.updatedAt < input.createdAt || input.byteLength > MAX_PROJECT_BYTES) {
    throw new Error('Saved project metadata is damaged.');
  }
  return {
    id: input.id, name: input.name, createdAt: input.createdAt, updatedAt: input.updatedAt,
    byteLength: input.byteLength, formula: input.formula, kind: input.kind, orbitalCount: input.orbitalCount,
  };
}

function storageError(cause: unknown): Error {
  const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : undefined;
  if (name === 'QuotaExceededError') return new Error('Browser project storage is full. Export a project or remove a saved copy to make room.', { cause });
  if (name === 'SecurityError' || name === 'NotAllowedError') return new Error('Browser project storage is unavailable or permission was denied. You can still export a project file.', { cause });
  if (cause instanceof Error && cause.name === 'Error') return cause;
  return new Error('The browser could not complete the project storage operation. Try again or export a project file.', { cause });
}

function newProjectId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function transact<T>(database: IDBDatabase, stores: string[], mode: IDBTransactionMode,
  queue: (transaction: IDBTransaction, result: (value: T) => void, fail: (cause: unknown) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = database.transaction(stores, mode); }
    catch (cause) { reject(storageError(cause)); return; }
    let value: T;
    let failure: unknown;
    transaction.oncomplete = () => resolve(value);
    transaction.onabort = () => reject(storageError(failure ?? transaction.error));
    const fail = (cause: unknown) => {
      failure = cause;
      try { transaction.abort(); }
      catch { reject(storageError(cause)); }
    };
    try { queue(transaction, result => { value = result; }, fail); }
    catch (cause) { fail(cause); }
  });
}

export function createSavedProjectStore(factory?: IDBFactory) {
  let connection: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;

  function open(): Promise<IDBDatabase> {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      let settled = false;
      try {
        const source = factory ?? globalThis.indexedDB;
        if (!source) throw new Error('This browser does not provide project storage. You can still export a project file.');
        request = source.open(SAVED_PROJECTS_DATABASE_NAME, DATABASE_VERSION);
      } catch (cause) { reject(storageError(cause)); return; }
      request.onblocked = () => {
        settled = true;
        reject(new Error('Project storage is blocked by another IboView tab. Close or reload other tabs and try again.'));
      };
      request.onerror = () => { settled = true; reject(storageError(request.error)); };
      request.onupgradeneeded = () => {
        if (settled) { request.transaction?.abort(); return; }
        const database = request.result;
        database.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        database.createObjectStore(CONTENTS_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true;
        connection = database;
        const clearConnection = () => {
          if (connection === database) connection = undefined;
          if (opening === promise) opening = undefined;
        };
        database.onversionchange = () => { database.close(); clearConnection(); };
        database.onclose = clearConnection;
        resolve(database);
      };
    });
    opening = promise;
    void promise.catch(() => { if (opening === promise) opening = undefined; });
    return promise;
  }

  return {
    async list(): Promise<SavedProjectSummary[]> {
      const database = await open();
      const entries = await transact<unknown[]>(database, [METADATA_STORE], 'readonly', (transaction, result) => {
        const request = transaction.objectStore(METADATA_STORE).getAll();
        request.onsuccess = () => result(request.result);
      });
      return entries.map(readSummary).sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    async get(id: string): Promise<SavedProjectRecord | undefined> {
      validId(id);
      const database = await open();
      let metadata: unknown;
      let payload: { id: string; contents: string } | undefined;
      await transact<void>(database, [METADATA_STORE, CONTENTS_STORE], 'readonly', transaction => {
        const summaryRequest = transaction.objectStore(METADATA_STORE).get(id);
        const contentsRequest = transaction.objectStore(CONTENTS_STORE).get(id);
        summaryRequest.onsuccess = () => { metadata = summaryRequest.result; };
        contentsRequest.onsuccess = () => { payload = contentsRequest.result; };
      });
      if (metadata === undefined && payload === undefined) return undefined;
      if (metadata === undefined || !payload || typeof payload.contents !== 'string') throw new Error('This saved project is incomplete. Open an exported project file if you have a copy.');
      return { ...readSummary(metadata), contents: payload.contents };
    },

    async save(input: SaveProjectInput): Promise<SavedProjectSummary> {
      validateMetadata(input);
      if (input.id !== undefined) validId(input.id);
      if (typeof input.contents !== 'string' || !input.contents.trim()) throw new Error('Saved project contents must be nonempty text.');
      if (input.contents.length > MAX_PROJECT_BYTES) throw new Error('Project files must be 200 MB or smaller.');
      const byteLength = new Blob([input.contents]).size;
      if (byteLength > MAX_PROJECT_BYTES) throw new Error('Project files must be 200 MB or smaller.');
      const id = input.id ?? newProjectId();
      const name = browserProjectName(input.name);
      const database = await open();
      return transact<SavedProjectSummary>(database, [METADATA_STORE, CONTENTS_STORE], 'readwrite', (transaction, result, fail) => {
        const metadata = transaction.objectStore(METADATA_STORE);
        const contents = transaction.objectStore(CONTENTS_STORE);
        const request = metadata.get(id);
        request.onsuccess = () => {
          try {
            const previous = request.result === undefined ? undefined : readSummary(request.result);
            if (input.id && !previous) throw new Error('This saved project no longer exists. Use Save As to create a new browser copy.');
            const now = Math.max(Date.now(), previous?.updatedAt ?? 0);
            const summary: SavedProjectSummary = {
              id, name, createdAt: previous?.createdAt ?? now, updatedAt: now, byteLength,
              formula: input.formula, kind: input.kind, orbitalCount: input.orbitalCount,
            };
            metadata.put(summary);
            contents.put({ id, contents: input.contents });
            result(summary);
          } catch (cause) { fail(cause); }
        };
      });
    },

    async remove(id: string): Promise<void> {
      validId(id);
      const database = await open();
      await transact<void>(database, [METADATA_STORE, CONTENTS_STORE], 'readwrite', transaction => {
        transaction.objectStore(METADATA_STORE).delete(id);
        transaction.objectStore(CONTENTS_STORE).delete(id);
      });
    },
  };
}

export const savedProjectStore = createSavedProjectStore();

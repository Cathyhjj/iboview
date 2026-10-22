import { DEMOS } from './demos';

export interface DemoSelection { demoId: string; orbitalId?: string }
export const DEMO_SELECTION_STORAGE_KEY = 'iboview-demo-selection-v1';
export const DEMO_ORBITALS_STORAGE_KEY = 'iboview-demo-orbitals-v1';

const isDemoId = (value: unknown): value is string => typeof value === 'string' && DEMOS.some(demo => demo.id === value);
const isOrbitalId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

function readDemoOrbitals(raw: string | null): Record<string, string> {
  try {
    const stored: unknown = JSON.parse(raw ?? 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    const value = stored as Record<string, unknown>;
    return Object.fromEntries(DEMOS.flatMap(({ id }) => isOrbitalId(value[id]) ? [[id, value[id]]] : []));
  } catch { return {}; }
}

export function loadDemoSelection(storage?: Pick<Storage, 'getItem'>): DemoSelection {
  const fallback = { demoId: DEMOS[0].id };
  try {
    const stored: unknown = JSON.parse((storage ?? window.localStorage).getItem(DEMO_SELECTION_STORAGE_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return fallback;
    const value = stored as Record<string, unknown>;
    if (!isDemoId(value.demoId)) return fallback;
    return isOrbitalId(value.orbitalId) ? { demoId: value.demoId, orbitalId: value.orbitalId } : { demoId: value.demoId };
  } catch {
    return fallback;
  }
}

export function loadDemoOrbital(demoId: string, storage?: Pick<Storage, 'getItem'>): string | undefined {
  if (!isDemoId(demoId)) return undefined;
  try {
    const target = storage ?? window.localStorage;
    const orbitalId = readDemoOrbitals(target.getItem(DEMO_ORBITALS_STORAGE_KEY))[demoId];
    if (orbitalId) return orbitalId;
    const previous = loadDemoSelection(target);
    return previous.demoId === demoId ? previous.orbitalId : undefined;
  } catch { return undefined; }
}

export function saveDemoSelection({ demoId, orbitalId }: DemoSelection, storage?: Pick<Storage, 'getItem' | 'setItem'>): void {
  if (!isDemoId(demoId)) return;
  try {
    const target = storage ?? window.localStorage;
    const orbitals = readDemoOrbitals(target.getItem(DEMO_ORBITALS_STORAGE_KEY));
    const previous = loadDemoSelection(target);
    if (previous.orbitalId && !orbitals[previous.demoId]) orbitals[previous.demoId] = previous.orbitalId;
    if (isOrbitalId(orbitalId)) orbitals[demoId] = orbitalId;
    const selection = isOrbitalId(orbitalId) ? { demoId, orbitalId } : { demoId };
    target.setItem(DEMO_ORBITALS_STORAGE_KEY, JSON.stringify(orbitals));
    target.setItem(DEMO_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch { /* Selection remains usable when browser storage is unavailable. */ }
}

export async function loadRememberedDemo<Result>(
  load: (demoId: string, orbitalId?: string) => Promise<Result>, selection: DemoSelection,
): Promise<Result> {
  try {
    return await load(selection.demoId, selection.orbitalId);
  } catch (cause) {
    if (!selection.orbitalId || !(cause instanceof Error)
      || cause.message !== 'This example does not contain the requested orbital.') throw cause;
    return load(selection.demoId);
  }
}

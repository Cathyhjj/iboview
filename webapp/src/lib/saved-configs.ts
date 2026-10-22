import { parseAppearanceConfig, serializeAppearanceConfig } from './appearance-config';

export const SAVED_CONFIGS_STORAGE_KEY = 'iboview-saved-configs-v1';
export const MAX_SAVED_CONFIGS = 100;
const MAX_STORAGE_BYTES = 2 * 1024 * 1024;
const STORAGE_VERSION = 1;

export interface SavedAppearanceConfig {
  name: string;
  contents: string;
}

export function savedConfigName(name: string): string {
  let normalized = name.trim();
  for (;;) {
    // Truncation can expose another filename suffix.
    const next = Array.from(normalized.replace(/(?:\.iboview-config\.json\s*)+$/i, '').trim()).slice(0, 120).join('').trim();
    if (next === normalized) return next || 'My appearance';
    normalized = next;
  }
}

export function canonicalConfigContents(contents: string): string {
  const config = parseAppearanceConfig(contents);
  config.appearance.elementColors = Object.fromEntries(Object.entries(config.appearance.elementColors)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return serializeAppearanceConfig({
    settings: {
      ...config.appearance, opacity: config.opacity, material: config.material,
      positiveColor: config.colors.positiveColor, negativeColor: config.colors.negativeColor,
      // These required DisplaySettings fields are excluded from the config format.
      isovalue: 0.02, surface: true, spinning: false,
    },
    colors: config.colors, theme: config.theme,
  });
}

function validatedEntry(value: unknown): SavedAppearanceConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved config entry is invalid.');
  const input = value as Record<string, unknown>;
  if (typeof input.name !== 'string') throw new Error('Saved config name must be text.');
  if (typeof input.contents !== 'string') throw new Error('Saved config contents must be text.');
  const name = savedConfigName(input.name);
  try { return { name, contents: canonicalConfigContents(input.contents) }; }
  catch (error) {
    throw new Error(`Saved config "${name}" is invalid: ${error instanceof Error ? error.message : 'Invalid appearance settings.'}`);
  }
}

function validatedEntries(entries: readonly SavedAppearanceConfig[]): SavedAppearanceConfig[] {
  if (!Array.isArray(entries)) throw new Error('Saved configs must be a list.');
  const unique = new Map<string, SavedAppearanceConfig>();
  for (const entry of entries) {
    const normalized = validatedEntry(entry);
    unique.set(normalized.name, normalized);
  }
  if (unique.size > MAX_SAVED_CONFIGS) throw new Error(`You can save up to ${MAX_SAVED_CONFIGS} configs in this browser.`);
  return [...unique.values()];
}

function tooLarge(text: string): boolean {
  return text.length > MAX_STORAGE_BYTES || new TextEncoder().encode(text).byteLength > MAX_STORAGE_BYTES;
}

export function loadSavedConfigs(storage?: Pick<Storage, 'getItem'>): SavedAppearanceConfig[] {
  try {
    const raw = (storage ?? window.localStorage).getItem(SAVED_CONFIGS_STORAGE_KEY);
    if (!raw || tooLarge(raw)) return [];
    const document: unknown = JSON.parse(raw);
    if (!document || typeof document !== 'object' || Array.isArray(document)) return [];
    const input = document as Record<string, unknown>;
    if (input.version !== STORAGE_VERSION || !Array.isArray(input.entries)) return [];
    const unique = new Map<string, SavedAppearanceConfig>();
    for (const entry of input.entries) {
      try {
        const normalized = validatedEntry(entry);
        if (unique.has(normalized.name) || unique.size < MAX_SAVED_CONFIGS) unique.set(normalized.name, normalized);
      } catch { /* Retain the other saved configs when an individual entry is damaged. */ }
    }
    return [...unique.values()];
  } catch {
    return [];
  }
}

export function saveSavedConfigs(entries: SavedAppearanceConfig[], storage?: Pick<Storage, 'setItem'>): void {
  const text = JSON.stringify({ version: STORAGE_VERSION, entries: validatedEntries(entries) });
  if (tooLarge(text)) throw new Error('Saved configs exceed the 2 MB browser storage limit. Export or remove some configs first.');
  try { (storage ?? window.localStorage).setItem(SAVED_CONFIGS_STORAGE_KEY, text); }
  catch {
    throw new Error('Could not save configs in this browser. Storage may be unavailable or full. Export a config file to keep a copy.');
  }
}

export function upsertSavedConfig(entries: SavedAppearanceConfig[], entry: SavedAppearanceConfig): SavedAppearanceConfig[] {
  return validatedEntries([...entries, entry]);
}

export function uniqueSavedConfigName(entries: SavedAppearanceConfig[], name: string): string {
  const base = savedConfigName(name);
  const names = new Set(entries.map(entry => savedConfigName(entry.name)));
  if (!names.has(base)) return base;
  for (let index = 2; ; index++) {
    const suffix = ` (${index})`;
    const candidate = `${Array.from(base).slice(0, 120 - suffix.length).join('').trimEnd()}${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}

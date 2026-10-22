import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MOLECULE_APPEARANCE } from '../src/lib/molecule-appearance';
import { DEFAULT_ORBITAL_COLORS, orbitalPhaseColors } from '../src/lib/orbital-colors';
import { parseAppearanceConfig, serializeAppearanceConfig } from '../src/lib/appearance-config';
import { MAX_SAVED_CONFIGS, SAVED_CONFIGS_STORAGE_KEY, canonicalConfigContents, loadSavedConfigs,
  saveSavedConfigs, savedConfigName, uniqueSavedConfigName, upsertSavedConfig, type SavedAppearanceConfig } from '../src/lib/saved-configs';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const snapshot = {
  settings: { ...DEFAULT_MOLECULE_APPEARANCE, opacity: 0.8, material: 'soft' as const,
    isovalue: 0.02, surface: true, spinning: false, ...orbitalPhaseColors(DEFAULT_ORBITAL_COLORS) },
  colors: { ...DEFAULT_ORBITAL_COLORS, palette: 'plasma' as const, gradientExtent: 0.7 }, theme: 'dark' as const,
};
const contents = serializeAppearanceConfig(snapshot);
const customContents = serializeAppearanceConfig({ ...snapshot, colors: { ...snapshot.colors, palette: 'custom', positiveColor: '#abcdef' } });
const entry = (name = 'Plasma', text = contents): SavedAppearanceConfig => ({ name, contents: text });
const storedJSON = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

describe('named browser appearance configs', () => {
  it('persists named settings and reloads complete configs without project data', () => {
    const storage = memoryStorage();
    const entries = [entry('深色等值面 🔬'), entry('Custom', customContents)];
    saveSavedConfigs(entries, storage);
    expect(SAVED_CONFIGS_STORAGE_KEY).toBe('iboview-saved-configs-v1');
    expect(JSON.parse(storage.getItem(SAVED_CONFIGS_STORAGE_KEY)!)).toEqual({ version: 1, entries });
    expect(loadSavedConfigs(storage)).toEqual(entries);
    expect(parseAppearanceConfig(loadSavedConfigs(storage)[1].contents).colors.positiveColor).toBe('#abcdef');
    expect(storage.getItem(SAVED_CONFIGS_STORAGE_KEY)).not.toMatch(/isovalue|surface|spinning|camera|scene/);
  });

  it('overwrites the same normalized name in place, appends different names, and does not mutate inputs', () => {
    const original = [entry('First'), entry('Second')];
    const changed = upsertSavedConfig(original, entry(' First.iboview-config.json ', customContents));
    expect(changed).toEqual([entry('First', customContents), entry('Second')]);
    expect(original).toEqual([entry('First'), entry('Second')]);
    expect(upsertSavedConfig(changed, entry('first'))).toEqual([...changed, entry('first')]);
  });

  it('canonicalizes imported whitespace, property order, and element override order', () => {
    const document = JSON.parse(contents);
    document.appearance.elementColors = { Re: '#123456', C: '#abcdef' };
    const reordered = { ...document, appearance: { ...document.appearance, elementColors: { C: '#abcdef', Re: '#123456' } } };
    expect(canonicalConfigContents(JSON.stringify(document))).toBe(canonicalConfigContents(JSON.stringify(reordered, null, 4)));
    const restored = loadSavedConfigs(storedJSON({ version: 1, entries: [entry('Import', JSON.stringify(document))] }));
    expect(restored[0].contents).toBe(canonicalConfigContents(JSON.stringify(document)));
  });

  it('keeps valid entries when neighboring entries are corrupt or from another format', () => {
    const entries = [null, entry('First'), { name: 3, contents }, entry('Broken', '{broken'),
      { name: 'Missing contents' }, entry('Project', '{"format":"iboview-project","version":1}'), entry('Last', customContents)];
    expect(loadSavedConfigs(storedJSON({ version: 1, entries }))).toEqual([entry('First'), entry('Last', customContents)]);
  });

  it('resolves duplicate normalized names using the last valid entry while preserving list order', () => {
    const entries = [entry('One'), entry('Two'), entry(' One ', customContents), entry('One', '{broken')];
    expect(loadSavedConfigs(storedJSON({ version: 1, entries }))).toEqual([entry('One', customContents), entry('Two')]);
    const storage = memoryStorage();
    saveSavedConfigs(entries.slice(0, 3), storage);
    expect(loadSavedConfigs(storage)).toEqual([entry('One', customContents), entry('Two')]);
  });

  it.each([null, [], 42, true, {}, { version: 2, entries: [entry()] }, { version: 1, entries: {} }, { entries: [entry()] }])
    ('returns an empty list for invalid storage schema %j', value => {
      expect(loadSavedConfigs(storedJSON(value))).toEqual([]);
    });

  it('handles absent, malformed, denied, and oversized storage', () => {
    expect(loadSavedConfigs(memoryStorage())).toEqual([]);
    expect(loadSavedConfigs({ getItem: () => '{broken' })).toEqual([]);
    expect(loadSavedConfigs({ getItem: () => { throw new Error('Access denied'); } })).toEqual([]);
    expect(loadSavedConfigs({ getItem: () => ' '.repeat(2 * 1024 * 1024 + 1) })).toEqual([]);
    expect(loadSavedConfigs()).toEqual([]);
  });

  it.each(['QuotaExceededError', 'SecurityError'])('reports a failed save for %s instead of pretending it succeeded', name => {
    const storage = { setItem: () => { throw new DOMException('Blocked', name); } };
    expect(() => saveSavedConfigs([entry()], storage)).toThrow(/Could not save configs.*unavailable or full/);
  });

  it('reports unavailable browser storage and validates everything before writing', () => {
    expect(() => saveSavedConfigs([entry()])).toThrow(/Could not save configs/);
    const storage = { setItem: vi.fn() };
    expect(() => saveSavedConfigs([entry('Good'), entry('Bad', '{broken')], storage)).toThrow(/Bad.*valid JSON/);
    expect(() => saveSavedConfigs([{ name: 42, contents } as unknown as SavedAppearanceConfig], storage)).toThrow(/name must be text/);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('limits distinct configs without preventing updates at capacity', () => {
    const full = Array.from({ length: MAX_SAVED_CONFIGS }, (_, index) => entry(`Config ${index}`));
    expect(MAX_SAVED_CONFIGS).toBe(100);
    expect(() => upsertSavedConfig(full, entry('One more'))).toThrow(/up to 100/);
    expect(upsertSavedConfig(full, entry('Config 0', customContents))[0].contents).toBe(customContents);
    const storage = { setItem: vi.fn() };
    expect(() => saveSavedConfigs([...full, entry('One more')], storage)).toThrow(/up to 100/);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(loadSavedConfigs(storedJSON({ version: 1, entries: [...full, entry('One more')] }))).toEqual(full);
  });

  it.each([
    ['  Plasma.iboview-config.json  ', 'Plasma'], ['中文颜色', '中文颜色'],
    [' .iboview-config.json ', 'My appearance'], ['', 'My appearance'], ['A.json', 'A.json'],
  ])('normalizes %s to %s', (name, expected) => {
    expect(savedConfigName(name)).toBe(expected);
  });

  it('limits Unicode names without splitting surrogate pairs and produces bounded unique names', () => {
    const longName = '🔬'.repeat(130);
    const normalized = savedConfigName(longName);
    expect(normalized).toBe('🔬'.repeat(120));
    const unique = uniqueSavedConfigName([entry(normalized)], longName);
    expect(unique).toBe(`${'🔬'.repeat(116)} (2)`);
    expect(Array.from(unique)).toHaveLength(120);
  });

  it.each([
    ['Style.iboview-config.json.iboview-config.json', 'Style'],
    [`Style${'.iboview-config.json'.repeat(20)}`, 'Style'],
    [' Style.iboview-config.json .IBOVIEW-CONFIG.JSON ', 'Style'],
    [`${'A'.repeat(100)}.iboview-config.jsontail`, 'A'.repeat(100)],
    [`${'🔬'.repeat(100)}.iboview-config.jsontail`, '🔬'.repeat(100)],
    ['.iboview-config.json.iboview-config.json', 'My appearance'],
  ])('keeps normalization idempotent for %s', (input, expected) => {
    const normalized = savedConfigName(input);
    expect(normalized).toBe(expected);
    expect(savedConfigName(normalized)).toBe(normalized);
    expect(savedConfigName(savedConfigName(normalized))).toBe(normalized);
  });

  it.each([
    ['Style.iboview-config.json.iboview-config.json', 'Style'],
    [`${'A'.repeat(100)}.iboview-config.jsontail`, 'A'.repeat(100)],
  ])('uses the same identity for overwrite checks and persistence with %s', (input, existingName) => {
    const existing = [entry(existingName)];
    const warningName = savedConfigName(input);
    expect(existing.find(item => item.name === warningName)).toBe(existing[0]);
    const updated = upsertSavedConfig(existing, entry(warningName, customContents));
    expect(updated).toEqual([entry(existingName, customContents)]);
    const storage = memoryStorage();
    saveSavedConfigs(updated, storage);
    expect(loadSavedConfigs(storage)).toEqual(updated);
    expect(loadSavedConfigs(storage)[0].name).toBe(warningName);
  });

  it('chooses import names without overwriting an existing config', () => {
    expect(uniqueSavedConfigName([entry('Style'), entry('Style (2)')], 'Style.iboview-config.json')).toBe('Style (3)');
    expect(uniqueSavedConfigName([entry('Style')], 'New')).toBe('New');
  });
});

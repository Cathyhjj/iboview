import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISPLAY_PREFERENCES, DISPLAY_PREFERENCES_STORAGE_KEY,
  loadDisplayPreferences, saveDisplayPreferences, type DisplayPreferences,
} from '../src/lib/display-preferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const storedJSON = (value: string | null) => ({ getItem: () => value });

describe('display preferences', () => {
  it.each(['shiny', 'soft', 'extra'] as const)('restores saved opacity and %s orbital material', material => {
    const storage = memoryStorage();
    const preferences: DisplayPreferences = { opacity: 0.73, material };
    saveDisplayPreferences(preferences, storage);
    expect(DISPLAY_PREFERENCES_STORAGE_KEY).toBe('iboview-display-preferences-v1');
    expect(JSON.parse(storage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)!)).toEqual(preferences);
    expect(loadDisplayPreferences(storage)).toEqual(preferences);
  });

  it('defaults to 55% opacity and Extra shiny before preferences are saved', () => {
    expect(DEFAULT_DISPLAY_PREFERENCES).toEqual({ opacity: 0.55, material: 'extra' });
    expect(loadDisplayPreferences(memoryStorage())).toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });

  it.each([
    [{ opacity: 0.32 }, { opacity: 0.32, material: 'extra' }],
    [{ material: 'soft' }, { opacity: 0.55, material: 'soft' }],
  ])('retains valid fields in partial saved preferences %j', (stored, expected) => {
    expect(loadDisplayPreferences(storedJSON(JSON.stringify(stored)))).toEqual(expected);
  });

  it.each(['{broken', 'null', '[]', '42', 'true', '"soft"', '{}'])('handles malformed or empty stored preferences %s', raw => {
    expect(loadDisplayPreferences(storedJSON(raw))).toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });

  it('validates opacity and orbital material independently', () => {
    expect(loadDisplayPreferences(storedJSON('{"opacity":"0.7","material":"soft"}')))
      .toEqual({ opacity: 0.55, material: 'soft' });
    expect(loadDisplayPreferences(storedJSON('{"opacity":0.7,"material":"unlit"}')))
      .toEqual({ opacity: 0.7, material: 'extra' });
    expect(loadDisplayPreferences(storedJSON('{"opacity":null,"material":false}')))
      .toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });

  it.each([[-2, 0.2], [0, 0.2], [0.2, 0.2], [1, 1], [4, 1]])('clamps finite opacity %s to %s', (stored, expected) => {
    expect(loadDisplayPreferences(storedJSON(JSON.stringify({ opacity: stored, material: 'shiny' }))))
      .toEqual({ opacity: expected, material: 'shiny' });
  });

  it.each(['1e999', '-1e999'])('rejects nonfinite opacity %s', value => {
    expect(loadDisplayPreferences(storedJSON(`{"opacity":${value},"material":"soft"}`)))
      .toEqual({ opacity: 0.55, material: 'soft' });
  });

  it('saves only orbital opacity and material from a larger display settings object', () => {
    const storage = memoryStorage();
    const settings = { opacity: 0.62, material: 'soft' as const,
      style: 'wireframe', atomMaterial: 'shiny', isovalue: 0.08, surface: true };
    saveDisplayPreferences(settings, storage);
    expect(JSON.parse(storage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY)!))
      .toEqual({ opacity: 0.62, material: 'soft' });
  });

  it('ignores molecular appearance fields when loading orbital display preferences', () => {
    const raw = JSON.stringify({ opacity: 0.8, style: 'space-fill', atomMaterial: 'soft', atomScale: 1.4 });
    expect(loadDisplayPreferences(storedJSON(raw))).toEqual({ opacity: 0.8, material: 'extra' });
  });

  it('keeps defaults usable when storage reads are blocked', () => {
    const blocked = { getItem: () => { throw new Error('Storage access denied'); } };
    expect(loadDisplayPreferences(blocked)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });

  it('does not interrupt display changes when storage writes fail', () => {
    const blocked = { setItem: () => { throw new Error('Storage quota exceeded'); } };
    expect(() => saveDisplayPreferences({ opacity: 0.8, material: 'shiny' }, blocked)).not.toThrow();
  });

  it('works without browser storage', () => {
    expect(loadDisplayPreferences()).toEqual(DEFAULT_DISPLAY_PREFERENCES);
    expect(() => saveDisplayPreferences(DEFAULT_DISPLAY_PREFERENCES)).not.toThrow();
  });

  it('persists defaults over a previous saved choice', () => {
    const storage = memoryStorage();
    saveDisplayPreferences({ opacity: 0.9, material: 'soft' }, storage);
    saveDisplayPreferences({ ...DEFAULT_DISPLAY_PREFERENCES }, storage);
    expect(loadDisplayPreferences(storage)).toEqual(DEFAULT_DISPLAY_PREFERENCES);
  });
});

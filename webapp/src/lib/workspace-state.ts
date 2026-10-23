export interface AtomStyle { color?: string }
export interface WorkspaceState { atomOverrides: Record<string, AtomStyle> }
export const DEFAULT_WORKSPACE: WorkspaceState = { atomOverrides: {} };
export function normalizeWorkspace(value: unknown, atomCount = 2000): WorkspaceState {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: WorkspaceState = { atomOverrides: {} };
  if (input.atomOverrides && typeof input.atomOverrides === 'object') {
    for (const [key, value] of Object.entries(input.atomOverrides)) {
      if (!/^\d+$/.test(key) || Number(key) >= atomCount || !value || typeof value !== 'object') continue;
      const { color } = value as AtomStyle;
      if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) result.atomOverrides[key] = { color };
    }
  }
  return result;
}

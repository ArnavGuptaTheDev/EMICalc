/**
 * localStorage persistence. Every access is guarded: private windows and
 * blocked storage make reads return defaults and writes fail softly.
 */
import type { LoanInputs } from './emi';

const NS = 'emicalc:v1:';
const KEYS = { saved: NS + 'saved', last: NS + 'last', prefs: NS + 'prefs' } as const;
export const MAX_SAVED = 50;

export interface SavedCalc {
  id: string;
  name: string;
  createdAt: string;
  inputs: LoanInputs;
  /** Snapshot for the list view so we don't recompute on open. */
  emi: number;
  totalPayable: number;
}

export interface Prefs {
  theme?: 'light' | 'dark' | 'system';
  scheduleView?: 'monthly' | 'yearly';
  tenureUnit?: 'months' | 'years';
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function storageAvailable(): boolean {
  try {
    const k = NS + 'probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/* saved calculations — newest first */

export function listSaved(): SavedCalc[] {
  const items = read<SavedCalc[]>(KEYS.saved, []);
  return Array.isArray(items) ? items.filter((x) => x && x.id && x.inputs) : [];
}

export function addSaved(item: Omit<SavedCalc, 'id' | 'createdAt'>): SavedCalc | null {
  const entry: SavedCalc = {
    ...item,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...listSaved()].slice(0, MAX_SAVED);
  return write(KEYS.saved, next) ? entry : null;
}

export function renameSaved(id: string, name: string): boolean {
  return write(
    KEYS.saved,
    listSaved().map((s) => (s.id === id ? { ...s, name } : s)),
  );
}

export function deleteSaved(id: string): boolean {
  return write(
    KEYS.saved,
    listSaved().filter((s) => s.id !== id),
  );
}

export function restoreSaved(items: SavedCalc[]): boolean {
  return write(KEYS.saved, items.slice(0, MAX_SAVED));
}

export function clearSaved(): boolean {
  return write(KEYS.saved, []);
}

/** Merge an imported backup, skipping ids we already have. Returns the number added. */
export function importSaved(data: unknown): number {
  if (!Array.isArray(data)) throw new Error('Not a EMICalc backup');
  const existing = listSaved();
  const ids = new Set(existing.map((s) => s.id));
  const incoming = (data as SavedCalc[]).filter(
    (s) => s && typeof s.id === 'string' && typeof s.name === 'string' && s.inputs && typeof s.inputs.principal === 'number' && !ids.has(s.id),
  );
  const merged = [...incoming, ...existing].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_SAVED);
  write(KEYS.saved, merged);
  return incoming.length;
}

/* last-used inputs */

export const loadLast = () => read<Partial<LoanInputs> | null>(KEYS.last, null);
export const saveLast = (i: LoanInputs) => write(KEYS.last, i);

/* preferences */

export const loadPrefs = () => read<Prefs>(KEYS.prefs, {});
export function savePrefs(patch: Prefs) {
  write(KEYS.prefs, { ...loadPrefs(), ...patch });
}

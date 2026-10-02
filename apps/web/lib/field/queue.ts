/**
 * File d'attente hors ligne de la vue terrain (03 §7, ADR 0014) : pointages, tâches,
 * signalements et photos sont d'abord écrits dans IndexedDB avec un identifiant généré sur le
 * téléphone, puis synchronisés dès que le réseau revient. Rejouer une action ne crée jamais de
 * doublon côté serveur (identifiants UUIDv7 + endpoints idempotents).
 */
import type { FieldAction, FieldTodayDto } from '@batimint/contracts';

export type QueuedAction = FieldAction & {
  createdAt: string;
  /** Erreur définitive renvoyée par le serveur : l'action est montrée à l'ouvrier, pas rejouée. */
  error?: { code: string; message: string } | null;
};

export interface QueuedPhoto {
  id: string;
  ownerType: 'project' | 'issue';
  ownerId: string;
  /** Chantier concerné (affichage et invalidation). */
  projectId: string;
  taskId: string | null;
  blob: Blob;
  fileName: string;
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  error?: { code: string; message: string } | null;
}

const DB_NAME = 'batimint-terrain';
const DB_VERSION = 1;
const STORES = { actions: 'actions', photos: 'photos', cache: 'cache' } as const;

type Listener = () => void;
const listeners = new Set<Listener>();

export function onQueueChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(): void {
  for (const l of listeners) l();
}

// Repli en mémoire (navigation privée sans IndexedDB, tests) : la file vit le temps de l'onglet.
const memory = {
  actions: new Map<string, QueuedAction>(),
  photos: new Map<string, QueuedPhoto>(),
  cache: new Map<string, unknown>(),
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.actions))
          db.createObjectStore(STORES.actions, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.photos))
          db.createObjectStore(STORES.photos, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.cache)) db.createObjectStore(STORES.cache);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  store: keyof typeof STORES,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        if (!db) return reject(new Error('no-idb'));
        const tx = db.transaction(STORES[store], mode);
        const req = fn(tx.objectStore(STORES[store]));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? new Error('idb'));
        tx.onabort = () => reject(tx.error ?? new Error('idb'));
      }),
  );
}

async function noIdb(): Promise<boolean> {
  return (await openDb()) === null;
}

const byCreated = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

export async function listActions(): Promise<QueuedAction[]> {
  if (await noIdb()) return [...memory.actions.values()].sort(byCreated);
  return (await run<QueuedAction[]>('actions', 'readonly', (s) => s.getAll())).sort(byCreated);
}

export async function enqueueAction(action: FieldAction): Promise<QueuedAction> {
  const row: QueuedAction = { ...action, createdAt: new Date().toISOString(), error: null };
  if (await noIdb()) memory.actions.set(row.id, row);
  else await run('actions', 'readwrite', (s) => s.put(row));
  emit();
  return row;
}

export async function removeActions(ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (await noIdb()) for (const id of ids) memory.actions.delete(id);
  else
    await openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db!.transaction(STORES.actions, 'readwrite');
          for (const id of ids) tx.objectStore(STORES.actions).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('idb'));
        }),
    );
  emit();
}

export async function markActionError(id: string, error: { code: string; message: string }): Promise<void> {
  const rows = await listActions();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  const next = { ...row, error };
  if (await noIdb()) memory.actions.set(id, next);
  else await run('actions', 'readwrite', (s) => s.put(next));
  emit();
}

export async function listPhotos(): Promise<QueuedPhoto[]> {
  if (await noIdb()) return [...memory.photos.values()].sort(byCreated);
  return (await run<QueuedPhoto[]>('photos', 'readonly', (s) => s.getAll())).sort(byCreated);
}

export async function enqueuePhoto(photo: Omit<QueuedPhoto, 'createdAt' | 'error'>): Promise<void> {
  const row: QueuedPhoto = { ...photo, createdAt: new Date().toISOString(), error: null };
  if (await noIdb()) memory.photos.set(row.id, row);
  else await run('photos', 'readwrite', (s) => s.put(row));
  emit();
}

export async function removePhoto(id: string): Promise<void> {
  if (await noIdb()) memory.photos.delete(id);
  else await run('photos', 'readwrite', (s) => s.delete(id));
  emit();
}

export async function markPhotoError(id: string, error: { code: string; message: string }): Promise<void> {
  const row = (await listPhotos()).find((p) => p.id === id);
  if (!row) return;
  const next = { ...row, error };
  if (await noIdb()) memory.photos.set(id, next);
  else await run('photos', 'readwrite', (s) => s.put(next));
  emit();
}

/** Dernière journée reçue : affichée hors ligne au lieu d'un écran d'erreur. */
export async function cacheToday(key: string, value: FieldTodayDto): Promise<void> {
  try {
    if (await noIdb()) memory.cache.set(key, value);
    else await run('cache', 'readwrite', (s) => s.put(value, key));
  } catch {
    /* cache facultatif */
  }
}

export async function cachedToday(key: string): Promise<FieldTodayDto | null> {
  try {
    if (await noIdb()) return (memory.cache.get(key) as FieldTodayDto | undefined) ?? null;
    return (
      ((await run<unknown>('cache', 'readonly', (s) => s.get(key))) as FieldTodayDto | undefined) ?? null
    );
  } catch {
    return null;
  }
}

/** Efface la file à la déconnexion (téléphone partagé). */
export async function clearAll(): Promise<void> {
  memory.actions.clear();
  memory.photos.clear();
  memory.cache.clear();
  const db = await openDb();
  if (db)
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORES.actions, STORES.photos, STORES.cache], 'readwrite');
      for (const s of Object.values(STORES)) tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  emit();
}

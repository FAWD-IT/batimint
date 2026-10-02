/**
 * Synchronisation de la file terrain : les actions partent par lots (POST /field/sync, une
 * transaction par action côté serveur), puis les photos une à une (identifiant fixé sur le
 * téléphone, donc renvoi sans doublon). Une coupure réseau arrête la passe ; la suivante reprend.
 */
import { api, ApiError } from '../api';
import { uploadRaw } from '../upload';
import {
  listActions,
  listPhotos,
  markActionError,
  markPhotoError,
  type QueuedAction,
  removeActions,
  removePhoto,
} from './queue';

export interface SyncResult {
  sent: number;
  failed: number;
  /** Arrêt sur coupure réseau ou erreur serveur : à retenter plus tard. */
  interrupted: boolean;
  geofence: { id: string; status: string }[];
}

const BATCH = 50;

let running: Promise<SyncResult> | null = null;
let queued: Promise<SyncResult> | null = null;

/**
 * Une seule passe à la fois. Un appel pendant une passe en programme une seconde juste après
 * (l'action ajoutée entre-temps part tout de suite, pas 30 s plus tard).
 */
export function syncQueue(): Promise<SyncResult> {
  if (!running) {
    running = doSync().finally(() => {
      running = null;
    });
    return running;
  }
  if (!queued)
    queued = running.then(() => {
      queued = null;
      return syncQueue();
    });
  return queued;
}

const isTransient = (err: unknown) =>
  !(err instanceof ApiError) ||
  err.status === 0 ||
  err.status >= 500 ||
  err.status === 429 ||
  err.status === 401;

async function doSync(): Promise<SyncResult> {
  const result: SyncResult = { sent: 0, failed: 0, interrupted: false, geofence: [] };
  const pending = (await listActions()).filter((a) => !a.error);
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch: QueuedAction[] = pending.slice(i, i + BATCH);
    try {
      const res = await api<{
        results: {
          id: string;
          ok: boolean;
          error: { code: string; message: string } | null;
          geofence?: string | null;
        }[];
      }>('/field/sync', {
        body: { actions: batch.map(({ type, id, data }) => ({ type, id, data })) },
        idempotencyKey: false,
      });
      const done: string[] = [];
      for (const r of res.results) {
        if (r.ok) {
          done.push(r.id);
          if (r.geofence) result.geofence.push({ id: r.id, status: r.geofence });
        } else if (r.error) {
          await markActionError(r.id, r.error);
          result.failed++;
        }
      }
      await removeActions(done);
      result.sent += done.length;
    } catch (err) {
      if (isTransient(err)) return { ...result, interrupted: true };
      // Lot refusé en bloc (validation) : on isole chaque action pour ne pas bloquer la file.
      for (const a of batch)
        await markActionError(a.id, { code: (err as ApiError).code, message: (err as ApiError).message });
      result.failed += batch.length;
    }
  }

  // Les photos d'un signalement attendent que le signalement soit arrivé.
  const waiting = new Set(
    (await listActions()).filter((a) => !a.error && a.type === 'issue').map((a) => a.id),
  );
  for (const p of (await listPhotos()).filter((x) => !x.error)) {
    if (p.ownerType === 'issue' && waiting.has(p.ownerId)) continue;
    const params = new URLSearchParams({
      ownerType: p.ownerType,
      ownerId: p.ownerId,
      kind: 'photo',
      id: p.id,
      takenAt: p.takenAt,
    });
    if (p.taskId) params.set('taskId', p.taskId);
    if (p.latitude !== null && p.longitude !== null) {
      params.set('lat', String(p.latitude));
      params.set('lng', String(p.longitude));
    }
    try {
      await uploadRaw(`/attachments?${params.toString()}`, p.blob, {
        fileName: p.fileName,
        contentType: p.blob.type || 'image/jpeg',
      });
      await removePhoto(p.id);
      result.sent++;
    } catch (err) {
      if (isTransient(err)) return { ...result, interrupted: true };
      await markPhotoError(p.id, { code: (err as ApiError).code, message: (err as ApiError).message });
      result.failed++;
    }
  }
  return result;
}

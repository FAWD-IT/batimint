/**
 * Envoi de fichiers bruts à l'API (photos, notes vocales, imports) avec clé d'idempotence :
 * un renvoi après coupure réseau ne crée pas de doublon.
 */
import { v7 as uuidv7 } from 'uuid';
import { ApiError } from './api';

export async function uploadRaw<T>(
  path: string,
  body: Blob,
  options: { fileName: string; contentType?: string; signal?: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': options.contentType || body.type || 'application/octet-stream',
        'x-file-name': encodeURIComponent(options.fileName),
        'idempotency-key': uuidv7(),
      },
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', '');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? '', e?.details);
  }
  return data as T;
}

/**
 * Compression côté navigateur avant envoi (04 : photos ≤ 1600 px, JPEG 80 %) : un chantier
 * en 4G ne doit pas attendre 8 Mo par photo. Les formats non décodables partent tels quels.
 */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

import { IntegrationError } from '../errors';
import type { Bucket, ObjectStorage, PutObjectInput } from './types';

/** Stockage en mémoire (tests). Le bucket « legal » refuse l'écrasement, comme en production. */
export class MemoryStorage implements ObjectStorage {
  readonly provider = 'memory';
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();

  async put(input: PutObjectInput): Promise<{ key: string }> {
    const id = `${input.bucket}/${input.key}`;
    if (input.bucket === 'legal' && this.objects.has(id)) {
      throw new IntegrationError('memory', 'Document légal déjà archivé : écrasement interdit.', false);
    }
    const body = typeof input.body === 'string' ? new TextEncoder().encode(input.body) : input.body;
    this.objects.set(id, { body, contentType: input.contentType });
    return { key: input.key };
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    const o = this.objects.get(`${bucket}/${key}`);
    if (!o) throw new IntegrationError('memory', `Objet introuvable : ${key}`, false);
    return o.body;
  }

  async exists(bucket: Bucket, key: string): Promise<boolean> {
    return this.objects.has(`${bucket}/${key}`);
  }

  async presignPut(bucket: Bucket, key: string): Promise<string> {
    return `memory://${bucket}/${key}?upload`;
  }

  async presignGet(bucket: Bucket, key: string): Promise<string> {
    return `memory://${bucket}/${key}`;
  }

  async ping(): Promise<void> {}
}

export type Bucket = 'uploads' | 'legal';

export interface PutObjectInput {
  bucket: Bucket;
  key: string;
  body: Uint8Array | string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface ObjectStorage {
  readonly provider: string;
  put(input: PutObjectInput): Promise<{ key: string; versionId?: string }>;
  get(bucket: Bucket, key: string): Promise<Uint8Array>;
  exists(bucket: Bucket, key: string): Promise<boolean>;
  /** URL d'upload direct depuis le navigateur. */
  presignPut(bucket: Bucket, key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  /** URL de lecture temporaire. */
  presignGet(bucket: Bucket, key: string, expiresInSeconds?: number): Promise<string>;
  /** Vérifie l'accès (bouton « Tester la connexion », /ready). */
  ping(): Promise<void>;
}

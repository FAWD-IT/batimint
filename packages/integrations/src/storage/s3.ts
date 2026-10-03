import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { IntegrationError } from '../errors';
import type { Bucket, ObjectStorage, PutObjectInput } from './types';

export interface S3Config {
  endpoint: string;
  publicEndpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  buckets: Record<Bucket, string>;
}

export class S3Storage implements ObjectStorage {
  readonly provider = 's3';
  private readonly client: S3Client;
  private readonly publicClient: S3Client;

  constructor(private readonly config: S3Config) {
    const base = {
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
    };
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.publicClient = new S3Client({ ...base, endpoint: config.publicEndpoint || config.endpoint });
  }

  private bucket(b: Bucket): string {
    return this.config.buckets[b];
  }

  async put(input: PutObjectInput): Promise<{ key: string; versionId?: string }> {
    try {
      if (input.bucket === 'legal' && (await this.exists('legal', input.key))) {
        throw new IntegrationError('s3', 'Document légal déjà archivé : écrasement interdit.', false);
      }
      const res = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket(input.bucket),
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
      return { key: input.key, versionId: res.VersionId };
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      throw new IntegrationError(
        's3',
        "Le fichier n'a pas pu être enregistré (stockage indisponible).",
        true,
        err,
      );
    }
  }

  async get(bucket: Bucket, key: string): Promise<Uint8Array> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
      if (!res.Body) throw new Error('corps vide');
      return await res.Body.transformToByteArray();
    } catch (err) {
      throw new IntegrationError('s3', `Fichier introuvable ou stockage indisponible (${key}).`, true, err);
    }
  }

  async exists(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw new IntegrationError('s3', 'Stockage indisponible.', true, err);
    }
  }

  presignPut(bucket: Bucket, key: string, contentType: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: this.bucket(bucket), Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds },
    );
  }

  presignGet(bucket: Bucket, key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async ping(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket('uploads') }));
    } catch (err) {
      throw new IntegrationError('s3', 'Stockage S3 injoignable ou bucket absent.', true, err);
    }
  }
}

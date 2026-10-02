import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Chiffrement applicatif AES-256-GCM des champs sensibles (INSS, secrets d'intégration). */
export class FieldCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    const raw = Buffer.from(secret, 'base64');
    this.key = raw.length === 32 ? raw : createHash('sha256').update(secret).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [v, ivB, tagB, encB] = payload.split('.');
    if (v !== 'v1' || !ivB || !tagB || !encB) throw new Error('Format chiffré inconnu');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encB, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  }
}

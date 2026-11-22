import { Buffer } from 'node:buffer';
import type {
  ObjectBody,
  ObjectMetadata,
  ObjectStorage,
  SignedUrlOptions,
} from '@scorm/domain';
import { NotFoundError } from '@scorm/domain';

interface StoredObject {
  body: Buffer;
  meta?: ObjectMetadata;
}

/**
 * ObjectStorage in-memory per sviluppo e test. Simula gli URL firmati con uno
 * schema interno `mock-storage://` e scadenza indicativa. NON per produzione.
 */
export class LocalObjectStorage implements ObjectStorage {
  readonly id = 'local';
  private readonly objects = new Map<string, StoredObject>();
  private readonly uploads = new Map<string, { key: string; meta?: ObjectMetadata; parts: Map<number, Buffer> }>();

  async startMultipart(key: string, meta?: ObjectMetadata): Promise<{ uploadId: string }> {
    const uploadId = `up-${this.uploads.size + 1}-${Date.now()}`;
    this.uploads.set(uploadId, { key, meta, parts: new Map() });
    return { uploadId };
  }
  async uploadPart(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<{ etag: string }> {
    const u = this.uploads.get(uploadId);
    if (!u || u.key !== key) throw new Error('Caricamento non trovato');
    u.parts.set(partNumber, Buffer.from(body));
    return { etag: `"p${partNumber}-${body.byteLength}"` };
  }
  async completeMultipart(key: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>): Promise<void> {
    const u = this.uploads.get(uploadId);
    if (!u || u.key !== key) throw new Error('Caricamento non trovato');
    const body = Buffer.concat([...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => u.parts.get(p.partNumber)!));
    this.uploads.delete(uploadId);
    await this.putObject(key, body, u.meta);
  }
  async abortMultipart(_key: string, uploadId: string): Promise<void> {
    this.uploads.delete(uploadId);
  }

  async putObject(key: string, body: ObjectBody, meta?: ObjectMetadata): Promise<void> {
    this.objects.set(key, { body: await toBuffer(body), meta });
  }

  async getObject(key: string): Promise<Buffer> {
    const obj = this.objects.get(key);
    if (!obj) throw new NotFoundError(`object:${key}`);
    return obj.body;
  }

  async getSignedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    if (!this.objects.has(key)) throw new NotFoundError(`object:${key}`);
    const expiresAt = Date.now() + opts.expiresInSec * 1000;
    const fn = opts.downloadFilename
      ? `&filename=${encodeURIComponent(opts.downloadFilename)}`
      : '';
    return `mock-storage://${encodeURIComponent(key)}?expires=${expiresAt}${fn}`;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}

async function toBuffer(body: ObjectBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  // Stream leggibile.
  const chunks: Buffer[] = [];
  for await (const chunk of body as NodeJS.ReadableStream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
  }
  return Buffer.concat(chunks);
}

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

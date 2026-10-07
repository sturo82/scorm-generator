import { Buffer } from 'node:buffer';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  ObjectBody,
  ObjectMetadata,
  ObjectStorage,
  SignedUrlOptions,
} from '@scorm/domain';
import { NotFoundError } from '@scorm/domain';

export interface S3ObjectStorageOptions {
  bucket: string;
  region?: string;
  /** Endpoint custom per S3-compatibili (LocalStack/MinIO in dev). */
  endpoint?: string;
  /**
   * Endpoint usato SOLO per generare gli URL firmati consegnati al browser.
   * Serve quando l'endpoint interno (es. http://localstack:4566, risolvibile
   * solo dentro la rete Docker) non è raggiungibile dal client. La firma viene
   * calcolata su questo host, quindi resta valida. In produzione (S3 reale) si
   * lascia indefinito e si usa l'endpoint AWS standard.
   */
  publicEndpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style necessario per LocalStack/MinIO. Default true se endpoint è impostato. */
  forcePathStyle?: boolean;
}

/**
 * Adapter ObjectStorage su S3 (o S3-compatibile come MinIO). I file sono privati
 * e l'accesso avviene solo tramite URL firmati a scadenza (Requisito 12.4).
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly id = 's3';
  private readonly client: S3Client;
  /** Client usato per il presigning: usa publicEndpoint se fornito. */
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(opts: S3ObjectStorageOptions) {
    this.bucket = opts.bucket;
    const credentials =
      opts.accessKeyId && opts.secretAccessKey
        ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
        : undefined;
    const forcePathStyle = opts.forcePathStyle ?? Boolean(opts.endpoint);
    this.client = new S3Client({
      region: opts.region ?? 'us-east-1',
      endpoint: opts.endpoint,
      forcePathStyle,
      credentials,
    });
    // Se è definito un endpoint pubblico diverso, un client dedicato firma gli
    // URL su quell'host; altrimenti riusa il client principale.
    this.signingClient =
      opts.publicEndpoint && opts.publicEndpoint !== opts.endpoint
        ? new S3Client({
            region: opts.region ?? 'us-east-1',
            endpoint: opts.publicEndpoint,
            forcePathStyle,
            credentials,
          })
        : this.client;
  }

  async putObject(key: string, body: ObjectBody, meta?: ObjectMetadata): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        // Il tipo del body del SDK copre Buffer/Uint8Array/stream; la nostra
        // ObjectBody è un sottoinsieme compatibile a runtime.
        Body: body as PutObjectCommandInput['Body'],
        ContentType: meta?.contentType,
        Metadata: meta?.custom,
      }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new NotFoundError(`object:${key}`);
      return Buffer.from(bytes);
    } catch (err) {
      if (isNotFound(err)) throw new NotFoundError(`object:${key}`, err);
      throw err;
    }
  }

  async getSignedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    // Content-Disposition: forza il nome del file scaricato lato browser anche
    // per URL cross-origin (dove l'attributo HTML `download` è ignorato).
    const responseContentDisposition = opts.downloadFilename
      ? `attachment; filename="${sanitizeFilename(opts.downloadFilename)}"`
      : undefined;
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: responseContentDisposition,
      }),
      { expiresIn: opts.expiresInSec },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

/** Rende sicuro un nome file per l'header Content-Disposition (no quote/CRLF). */
function sanitizeFilename(name: string): string {
  return name.replace(/["\\\r\n]/g, '').slice(0, 200) || 'download.zip';
}

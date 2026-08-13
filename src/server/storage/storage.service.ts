import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";

import { ENVIRONMENT } from "../config/environment.module.js";
import type { Environment } from "../config/environment.js";
import { StorageError } from "./storage.error.js";

export interface StoredObjectMetadata {
  readonly contentLength: number;
  readonly contentType?: string;
  readonly etag?: string;
}

export interface ObjectRangeStream extends StoredObjectMetadata {
  readonly contentRange?: string;
  readonly stream: Readable;
}

@Injectable()
export class StorageService implements OnModuleInit, OnApplicationShutdown {
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly presignTtlSeconds: number;
  private readonly requestTimeoutMs: number;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.bucket = environment.S3_BUCKET;
    this.presignTtlSeconds = environment.S3_PRESIGN_TTL_SECONDS;
    this.requestTimeoutMs = environment.S3_REQUEST_TIMEOUT_MS;
    const clientOptions = {
      endpoint: environment.S3_ENDPOINT,
      region: environment.S3_REGION,
      credentials: {
        accessKeyId: environment.S3_ACCESS_KEY,
        secretAccessKey: environment.S3_SECRET_KEY,
      },
      forcePathStyle: true,
    } satisfies ConstructorParameters<typeof S3Client>[0];
    this.client = new S3Client(clientOptions);
    this.presignClient = environment.S3_PUBLIC_ENDPOINT
      ? new S3Client({ ...clientOptions, endpoint: environment.S3_PUBLIC_ENDPOINT })
      : this.client;
  }

  async onModuleInit(): Promise<void> {
    await this.ping();
  }

  async ping(): Promise<void> {
    await this.executeWithTimeout((abortSignal) => this.client.send(
      new HeadBucketCommand({ Bucket: this.bucket }),
      { abortSignal },
    ));
  }

  createObjectKey(ownerId: string): string {
    return `owners/${encodeURIComponent(ownerId)}/imports/${randomUUID()}`;
  }

  async createPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = this.presignTtlSeconds,
  ): Promise<string> {
    const boundedExpiry = Math.min(
      this.presignTtlSeconds,
      Math.max(1, Math.floor(expiresInSeconds)),
    );
    return this.execute(() => getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        IfNoneMatch: "*",
      }),
      { expiresIn: boundedExpiry },
    ));
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
    const result = await this.executeWithTimeout((abortSignal) => this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal },
    ));

    if (result.ContentLength === undefined) {
      throw new StorageError("STORAGE_UNAVAILABLE", "Storage returned object metadata without a size.");
    }

    return {
      contentLength: result.ContentLength,
      ...(result.ContentType === undefined ? {} : { contentType: result.ContentType }),
      ...(result.ETag === undefined ? {} : { etag: result.ETag }),
    };
  }

  async getRangeStream(key: string, startByte: number): Promise<ObjectRangeStream> {
    if (!Number.isSafeInteger(startByte) || startByte < 0) {
      throw new RangeError("startByte must be a non-negative safe integer.");
    }

    const result = await this.executeWithTimeout((abortSignal) => this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=${startByte}-`,
      }),
      { abortSignal },
    ));

    if (!(result.Body instanceof Readable) || result.ContentLength === undefined) {
      throw new StorageError("STORAGE_UNAVAILABLE", "Storage returned an invalid range response.");
    }

    return {
      stream: result.Body,
      contentLength: result.ContentLength,
      ...(result.ContentRange === undefined ? {} : { contentRange: result.ContentRange }),
      ...(result.ContentType === undefined ? {} : { contentType: result.ContentType }),
      ...(result.ETag === undefined ? {} : { etag: result.ETag }),
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.executeWithTimeout((abortSignal) => this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal },
    ));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    if (this.presignClient !== this.client) {
      this.presignClient.destroy();
    }
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  private async executeWithTimeout<T>(
    operation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timer.unref();

    try {
      return await this.execute(() => operation(controller.signal));
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeError(error: unknown): StorageError {
    if (error instanceof StorageError) {
      return error;
    }

    if (error instanceof S3ServiceException && (error.name === "NoSuchKey" || error.$metadata.httpStatusCode === 404)) {
      return new StorageError("STORAGE_OBJECT_NOT_FOUND", "Storage object was not found.", { cause: error });
    }

    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return new StorageError("STORAGE_TIMEOUT", "Storage request timed out.", { cause: error });
    }

    return new StorageError("STORAGE_UNAVAILABLE", "Storage request failed.", { cause: error });
  }
}

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";

/**
 * The one place anything writes to object storage — MinIO in development,
 * S3 (or anything S3-compatible) in production, same client either way
 * because `S3_FORCE_PATH_STYLE` is what MinIO needs and a real bucket
 * ignores.
 *
 * Returns the PUBLIC url rather than a bucket/key pair: every caller wants a
 * link a browser or a WhatsApp message can open directly, and `S3_PUBLIC_URL`
 * is already the one place that knows whether that is a CDN, a reverse proxy,
 * or MinIO's own console port.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.bucket = this.config.get("S3_BUCKET", { infer: true });
    this.publicUrl = this.config.get("S3_PUBLIC_URL", { infer: true }).replace(/\/$/, "");

    this.client = new S3Client({
      endpoint: this.config.get("S3_ENDPOINT", { infer: true }),
      region: this.config.get("S3_REGION", { infer: true }),
      forcePathStyle: this.config.get("S3_FORCE_PATH_STYLE", { infer: true }),
      credentials: {
        accessKeyId: this.config.get("S3_ACCESS_KEY", { infer: true }),
        secretAccessKey: this.config.get("S3_SECRET_KEY", { infer: true }),
      },
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return `${this.publicUrl}/${key}`;
  }
}

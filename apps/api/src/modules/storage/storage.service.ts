import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Env } from "../../config/env.js";

/**
 * The one place anything writes to object storage — MinIO in development,
 * S3 (or anything S3-compatible) in production, same client either way
 * because `S3_FORCE_PATH_STYLE` is what MinIO needs and a real bucket
 * ignores. `STORAGE_DRIVER=local` swaps in a folder on disk, served by this
 * API at /uploads, for development without Docker.
 *
 * Returns the PUBLIC url rather than a bucket/key pair: every caller wants a
 * link a browser or a WhatsApp message can open directly, and the public URL
 * setting is already the one place that knows whether that is a CDN, a reverse
 * proxy, or MinIO's own console port.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: "s3" | "local";
  private readonly client?: S3Client;
  private bucket = "";
  private readonly publicUrl: string;
  /** Absolute folder for the local driver. Also what main.ts serves. */
  readonly localDir: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.driver = this.config.get("STORAGE_DRIVER", { infer: true }) ?? "s3";
    this.localDir = resolve(process.cwd(), this.config.get("STORAGE_LOCAL_DIR", { infer: true }) ?? "../../uploads");

    if (this.driver === "local") {
      const port = this.config.get("API_PORT", { infer: true });
      this.publicUrl = (this.config.get("STORAGE_LOCAL_PUBLIC_URL", { infer: true }) ?? `http://localhost:${port}/uploads`).replace(/\/$/, "");
      return;
    }

    const endpoint = this.config.get("S3_ENDPOINT", { infer: true });
    const accessKeyId = this.config.get("S3_ACCESS_KEY", { infer: true });
    const secretAccessKey = this.config.get("S3_SECRET_KEY", { infer: true });
    const bucket = this.config.get("S3_BUCKET", { infer: true });
    const publicUrl = this.config.get("S3_PUBLIC_URL", { infer: true });
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
      throw new Error("STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET and S3_PUBLIC_URL (or set STORAGE_DRIVER=local).");
    }
    this.bucket = bucket;
    this.publicUrl = publicUrl.replace(/\/$/, "");
    this.client = new S3Client({
      endpoint,
      region: this.config.get("S3_REGION", { infer: true }),
      forcePathStyle: this.config.get("S3_FORCE_PATH_STYLE", { infer: true }),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    try {
      if (this.driver === "local") {
        // Keys are built from ids and checksums, but a key must never be able to climb out of the folder.
        const target = resolve(this.localDir, key);
        if (!target.startsWith(this.localDir + sep)) throw new Error(`Key escapes the storage folder: ${key}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body);
      } else {
        await this.client!.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
      }
    } catch (error) {
      // Without this a stopped MinIO surfaces as an anonymous INTERNAL_ERROR.
      this.logger.error(`Upload of ${key} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new AppError(
        ERROR_CODES.STORAGE_UNAVAILABLE,
        this.driver === "local"
          ? "Could not write to the local storage folder. Check STORAGE_LOCAL_DIR."
          : "File storage is not reachable. Start it (pnpm infra:up) and check the S3_* settings.",
      );
    }
    return `${this.publicUrl}/${key}`;
  }
}

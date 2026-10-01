import { Global, Injectable, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ApiError } from '../../common/api-error.js';

export const UPLOAD_DIR = resolve(process.cwd(), 'uploads');

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'application/pdf': '.pdf',
};
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * File storage boundary for product images and datasheets. This driver writes
 * to ./uploads (served at /uploads); swap for S3/Cloudinary in production by
 * implementing the same `save` method.
 */
@Injectable()
export class StorageService {
  async save(file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
    const ext = ALLOWED[file.mimetype];
    if (!ext) throw ApiError.badRequest('FILE_TYPE', 'Only JPG, PNG, WebP, AVIF images and PDF files are allowed');
    if (file.size > MAX_BYTES) throw ApiError.badRequest('FILE_TOO_LARGE', 'Files must be 10 MB or smaller');

    const month = new Date().toISOString().slice(0, 7);
    const dir = join(UPLOAD_DIR, month);
    await mkdir(dir, { recursive: true });
    const name = `${randomUUID()}${ext}`;
    await writeFile(join(dir, name), file.buffer);
    return { url: `/uploads/${month}/${name}`, contentType: file.mimetype, size: file.size };
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}

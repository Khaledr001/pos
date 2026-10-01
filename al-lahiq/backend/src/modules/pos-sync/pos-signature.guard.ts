import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import type { AppRequest } from '../../common/auth.js';
import { AppConfig } from '../../config/app-config.service.js';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from './pos-signature.js';

/** Verifies POS → website webhooks against the raw request body. */
@Injectable()
export class PosSignatureGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const ok =
      !!req.rawBody &&
      verifySignature(
        this.config.get('POS_WEBHOOK_SECRET'),
        req.header(TIMESTAMP_HEADER),
        req.header(SIGNATURE_HEADER),
        req.rawBody,
        this.config.get('POS_WEBHOOK_TOLERANCE_SECONDS'),
      );
    if (!ok) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is missing, invalid or expired');
    return true;
  }
}

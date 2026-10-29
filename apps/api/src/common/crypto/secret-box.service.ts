import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";
import { developmentKey, parseEncryptionKey, SecretBox, SecretBoxError } from "./secret-box.js";

/**
 * The server's secret-at-rest box, keyed from APP_ENCRYPTION_KEY.
 *
 * Unset in production there is no box: saving a credential is refused with a
 * clear message rather than storing it in the clear. Unset elsewhere a fixed
 * development key is used, and the boot log says so — a developer is never
 * blocked, and a production box is never silently weak.
 */
@Injectable()
export class SecretBoxService {
  private readonly logger = new Logger(SecretBoxService.name);
  private readonly box: SecretBox | null;

  constructor(config: ConfigService<Env, true>) {
    const configured = config.get("APP_ENCRYPTION_KEY", { infer: true });
    if (configured) {
      this.box = new SecretBox(parseEncryptionKey(configured));
    } else if (config.get("NODE_ENV", { infer: true }) !== "production") {
      this.box = new SecretBox(developmentKey());
      this.logger.warn("APP_ENCRYPTION_KEY is not set: stored credentials use a fixed DEVELOPMENT key. Set it before going live (openssl rand -hex 32).");
    } else {
      this.box = null;
    }
  }

  get available(): boolean {
    return this.box !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.box) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "This server has no APP_ENCRYPTION_KEY, so it cannot store credentials safely. Ask whoever runs the platform to set it.");
    }
    return this.box.encrypt(plaintext);
  }

  /** Throws SecretBoxError if the value is unreadable (a rotated key, a damaged row). */
  decrypt(envelope: string): string {
    if (!this.box) throw new SecretBoxError("This server has no APP_ENCRYPTION_KEY");
    return this.box.decrypt(envelope);
  }
}

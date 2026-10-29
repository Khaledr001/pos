import type { Transaction } from "@devsfleet/db";
import type { EinvoiceSettings } from "@devsfleet/shared-types";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SecretBoxService } from "../../common/crypto/secret-box.service.js";
import type { Env } from "../../config/env.js";
import type { AspProvider } from "./providers/asp-provider.js";
import { GatewayProvider } from "./providers/gateway.provider.js";
import { SandboxProvider } from "./providers/sandbox.provider.js";

export type ResolvedProvider =
  | { ok: true; provider: AspProvider }
  /** Nothing usable: the message says what to configure. */
  | { ok: false; message: string };

/** Turns a tenant's stored provider account (and mode) into the driver that talks to it. */
@Injectable()
export class ProviderResolver {
  private readonly logger = new Logger(ProviderResolver.name);
  private readonly allowPrivate: boolean;

  /** Whether a private endpoint is acceptable (local development only). */
  get allowsPrivate(): boolean {
    return this.allowPrivate;
  }

  constructor(
    private readonly secrets: SecretBoxService,
    config: ConfigService<Env, true>,
  ) {
    // Local mock ASPs only; never honoured in production.
    this.allowPrivate = config.get("EINVOICE_GATEWAY_ALLOW_PRIVATE", { infer: true }) === true && config.get("NODE_ENV", { infer: true }) !== "production";
  }

  async resolve(tx: Transaction, settings: EinvoiceSettings): Promise<ResolvedProvider> {
    const account = await tx.query.einvoiceAccounts.findFirst();
    const provider = account?.isActive === false ? "sandbox" : (account?.provider ?? "sandbox");

    if (provider === "sandbox") {
      if (settings.mode === "live") {
        return { ok: false, message: "Live mode needs a real e-invoicing provider. Connect one in the e-invoicing settings, or switch to sandbox mode." };
      }
      return { ok: true, provider: new SandboxProvider() };
    }

    let credential: string | null = null;
    if (account?.credentialsEnc) {
      try {
        credential = this.secrets.decrypt(account.credentialsEnc);
      } catch {
        this.logger.error("A stored e-invoicing credential could not be decrypted (was APP_ENCRYPTION_KEY changed?)");
        return { ok: false, message: "The stored provider credentials cannot be read. Enter them again in the e-invoicing settings." };
      }
    }
    return { ok: true, provider: new GatewayProvider({ endpointUrl: account?.endpointUrl ?? null, credential, allowPrivate: this.allowPrivate }) };
  }
}

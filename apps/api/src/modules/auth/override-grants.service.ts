import type { OverrideGrantPayload, Permission, PermissionGrant } from "@devsfleet/shared-types";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { RequestContext } from "../../common/context/request-context.js";
import type { Env } from "../../config/env.js";

/**
 * Turns the grants attached to a request into extra authority, for this
 * request only.
 *
 * The problem this exists for: an override is approved at the counter and the
 * sale reaches the server later — sometimes hours later, from a terminal that
 * was offline in between. It arrives on the CASHIER's token. Without something
 * verifiable travelling with the document, the manager's approval is simply
 * not present at the moment the decision is made, and the sale is refused
 * after the goods have gone.
 *
 * The alternative — an `approvedBy` user id in the body — is not an option: it
 * would let any terminal name the owner and inherit their authority.
 *
 * A grant is therefore checked the same way a token is: signature, expiry,
 * tenant and branch. A grant that fails any of those is IGNORED rather than
 * fatal, and the caller's own permissions decide — a forged grant then buys
 * exactly nothing, and an expired one produces the same refusal as no approval
 * at all, which is the truthful answer.
 */
@Injectable()
export class OverrideGrantsService {
  private readonly logger = new Logger(OverrideGrantsService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async verify(grants: readonly string[] | undefined): Promise<OverrideGrantPayload[]> {
    if (!grants?.length) return [];

    const user = RequestContext.get()?.user;
    const secret = this.config.get("JWT_ACCESS_SECRET", { infer: true });
    const verified: OverrideGrantPayload[] = [];

    for (const grant of grants) {
      let payload: OverrideGrantPayload;
      try {
        payload = await this.jwt.verifyAsync<OverrideGrantPayload>(grant, { secret });
      } catch {
        this.logger.warn({ userId: user?.id }, "Discarding an unverifiable override grant");
        continue;
      }

      // `typ` is what stops an ACCESS token being presented here. They are
      // signed with the same key, and an access token carries a full
      // permission list — accepting one would hand over the whole session.
      if (payload.typ !== "override") continue;

      // A grant approved at one branch does not travel to another, and never
      // crosses a tenant even though RLS would stop the rows following it.
      if (user && payload.tenantId !== user.tenantId) continue;
      if (user?.branchId && payload.branchId !== user.branchId) continue;

      verified.push(payload);
    }

    return verified;
  }

  /** The caller's permissions plus whatever the grants add, for this request. */
  static permissionsWith(
    own: readonly PermissionGrant[],
    grants: readonly OverrideGrantPayload[],
  ): PermissionGrant[] {
    return [...own, ...grants.map((g) => g.permission)];
  }

  /**
   * The highest discount available once approvals are counted.
   *
   * A manager approving a discount lends their own ceiling to this document —
   * approving `sale:discount` while leaving the cashier's 0% cap in place
   * would authorise nothing.
   */
  static discountCeiling(
    own: string,
    grants: readonly OverrideGrantPayload[],
    permission: Permission,
  ): string {
    let best = own;
    for (const grant of grants) {
      if (grant.permission !== permission) continue;
      if (Number(grant.abac.maxDiscountPercent) > Number(best)) {
        best = grant.abac.maxDiscountPercent;
      }
    }
    return best;
  }
}

import { count, eq, isNull, schema } from "@devsfleet/db";
import {
  limitFor,
  limitMessage,
  resolvePlan,
  trialStatus,
  type Plan,
  type PlanResource,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";

/**
 * Plan limits.
 *
 * Enforced server-side, at the point of creation, by counting what already
 * exists. Not by a cached counter on the tenant row — a counter drifts the
 * first time something is deleted outside the one code path that decrements
 * it, and a drifted counter either blocks a paying customer or gives away
 * capacity for free.
 *
 * The count is cheap: these are small numbers (users, branches, devices) with
 * an index on tenant_id, and it runs only on create.
 */
@Injectable()
export class PlanLimitService {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * Throw if creating one more `resource` would exceed the tenant's plan.
   *
   * Platform operators are exempt — they provision on a tenant's behalf, and a
   * support action must not be blocked by the customer's own plan.
   */
  async assertCanCreate(resource: PlanResource): Promise<void> {
    const user = RequestContext.get()?.user;
    if (user?.isPlatformAdmin) return;

    const plan = resolvePlan(user?.planId);
    const limit = limitFor(plan, resource);
    if (limit === -1) return;

    const current = await this.countExisting(resource);
    if (current >= limit) {
      throw new AppError(
        ERROR_CODES.PLAN_LIMIT_EXCEEDED,
        limitMessage(plan, resource, limit),
        { resource, limit, current, plan: plan.id },
      );
    }
  }

  /**
   * Refuse writes once a trial has run out.
   *
   * Reads stay open deliberately. Locking someone out of their own data is how
   * you turn an expired trial into a support ticket and a bad review — they
   * should still be able to look at what they built, and export it.
   */
  assertTrialActive(): void {
    const user = RequestContext.get()?.user;
    if (user?.isPlatformAdmin) return;

    const store = RequestContext.get();
    const trial = trialStatus(
      user?.planId ?? "free",
      store?.trialEndsAt ?? null,
      new Date(),
    );

    if (trial.expired) {
      throw new AppError(
        ERROR_CODES.TRIAL_EXPIRED,
        "Your trial has ended. Choose a plan to continue adding data — " +
          "your existing data is untouched and still readable.",
      );
    }
  }

  /** Current usage against every limit. Feeds the billing screen. */
  async usage(): Promise<
    Array<{ resource: PlanResource; used: number; limit: number }>
  > {
    const plan = resolvePlan(RequestContext.get()?.user?.planId);
    const resources: PlanResource[] = ["users", "branches", "devices", "products"];

    return Promise.all(
      resources.map(async (resource) => ({
        resource,
        used: await this.countExisting(resource),
        limit: limitFor(plan, resource),
      })),
    );
  }

  currentPlan(): Plan {
    return resolvePlan(RequestContext.get()?.user?.planId);
  }

  /**
   * Only live rows count. A deactivated user still occupies a seat — they can
   * be reactivated without buying capacity — but a soft-deleted one does not.
   */
  private async countExisting(resource: PlanResource): Promise<number> {
    return this.db.run(async (tx) => {
      const [row] = await (() => {
        switch (resource) {
          case "users":
            return tx
              .select({ value: count() })
              .from(schema.users)
              .where(isNull(schema.users.deletedAt));
          case "branches":
            return tx
              .select({ value: count() })
              .from(schema.branches)
              .where(isNull(schema.branches.deletedAt));
          case "devices":
            return tx
              .select({ value: count() })
              .from(schema.devices)
              .where(eq(schema.devices.isActive, true));
          case "products":
            return tx
              .select({ value: count() })
              .from(schema.products)
              .where(isNull(schema.products.deletedAt));
        }
      })();

      return row?.value ?? 0;
    });
  }
}

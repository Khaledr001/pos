/**
 * Subscription plans.
 *
 * Defined in CODE, not as database rows. That is deliberate:
 *
 *  - Changing what a plan includes becomes a deployment, reviewed and
 *    testable, rather than an UPDATE somebody runs against production.
 *  - A tenant cannot be moved onto limits nobody has seen.
 *  - The limits can be unit-tested, which they are.
 *
 * The tenant row stores only the plan *id*. Everything else is looked up here.
 */

export const PLAN_IDS = ["free", "trial", "starter", "pro", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Sentinel for "no ceiling". Chosen over null so comparisons stay numeric. */
export const UNLIMITED = -1;

export interface Plan {
  id: PlanId;
  name: string;
  /** Active, non-deleted users. UNLIMITED for no cap. */
  maxUsers: number;
  /** Active branches. UNLIMITED for no cap. */
  maxBranches: number;
  /** Registered POS terminals. A branch with four tills needs four devices. */
  maxDevices: number;
  /** Catalogue size. The 5,000-SKU starting catalogue must fit the entry plan. */
  maxProducts: number;
  /** Monthly price in the platform's billing currency. null = talk to sales. */
  monthlyPrice: number | null;
  features: {
    whatsappAi: boolean;
    multiCurrency: boolean;
    /** Nightly database dump retained off-box. */
    automatedBackups: boolean;
    apiAccess: boolean;
    /** Cost, margin and profit reporting. */
    financialReports: boolean;
  };
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    maxUsers: 1,
    maxBranches: 1,
    maxDevices: 1,
    maxProducts: 100,
    monthlyPrice: 0,
    features: {
      whatsappAi: false,
      multiCurrency: false,
      automatedBackups: false,
      apiAccess: false,
      financialReports: false,
    },
  },
  trial: {
    id: "trial",
    name: "Trial",
    // A trial must be generous enough to import a real catalogue and run a
    // real shift, or it proves nothing and converts nobody.
    maxUsers: 5,
    maxBranches: 2,
    maxDevices: 4,
    maxProducts: 10_000,
    monthlyPrice: 0,
    features: {
      whatsappAi: true,
      multiCurrency: false,
      automatedBackups: false,
      apiAccess: false,
      financialReports: true,
    },
  },
  starter: {
    id: "starter",
    name: "Starter",
    maxUsers: 5,
    maxBranches: 2,
    maxDevices: 4,
    maxProducts: 10_000,
    monthlyPrice: 99,
    features: {
      whatsappAi: false,
      multiCurrency: false,
      automatedBackups: true,
      apiAccess: false,
      financialReports: true,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    maxUsers: 20,
    maxBranches: 10,
    maxDevices: 30,
    maxProducts: 100_000,
    monthlyPrice: 299,
    features: {
      whatsappAi: true,
      multiCurrency: true,
      automatedBackups: true,
      apiAccess: true,
      financialReports: true,
    },
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    maxUsers: UNLIMITED,
    maxBranches: UNLIMITED,
    maxDevices: UNLIMITED,
    maxProducts: UNLIMITED,
    monthlyPrice: null,
    features: {
      whatsappAi: true,
      multiCurrency: true,
      automatedBackups: true,
      apiAccess: true,
      financialReports: true,
    },
  },
};

/**
 * Resolve a plan id to its definition.
 *
 * Fails CLOSED: an unrecognised id — a typo, a plan removed in a later
 * release, a corrupted row — resolves to `free`. The failure mode of guessing
 * wrong must be a tenant that is too restricted and complains, never one
 * silently granted unlimited everything.
 */
export function resolvePlan(planId: string | null | undefined): Plan {
  if (planId && (PLAN_IDS as readonly string[]).includes(planId)) {
    return PLANS[planId as PlanId];
  }
  return PLANS.free;
}

/** True when `current` has reached the cap. UNLIMITED never blocks. */
export function isAtLimit(current: number, limit: number): boolean {
  return limit !== UNLIMITED && current >= limit;
}

export type PlanResource = "users" | "branches" | "devices" | "products";

const RESOURCE_LIMIT: Record<PlanResource, keyof Plan> = {
  users: "maxUsers",
  branches: "maxBranches",
  devices: "maxDevices",
  products: "maxProducts",
};

/** The cap for one resource under one plan. */
export function limitFor(plan: Plan, resource: PlanResource): number {
  return plan[RESOURCE_LIMIT[resource]] as number;
}

/** Message shown when a limit blocks an action. Names the plan and the number. */
export function limitMessage(plan: Plan, resource: PlanResource, limit: number): string {
  return (
    `Your ${plan.name} plan allows ${limit} ${resource}. ` +
    `Upgrade to add more.`
  );
}

/** Trial state, for the banner and for refusing writes once expired. */
export function trialStatus(
  planId: string,
  trialEndsAt: Date | null,
  now: Date,
): { onTrial: boolean; expired: boolean; daysLeft: number } {
  if (planId !== "trial" || !trialEndsAt) {
    return { onTrial: false, expired: false, daysLeft: 0 };
  }
  const msLeft = trialEndsAt.getTime() - now.getTime();
  return {
    onTrial: true,
    expired: msLeft <= 0,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86_400_000)),
  };
}

export const TRIAL_DAYS = 14;

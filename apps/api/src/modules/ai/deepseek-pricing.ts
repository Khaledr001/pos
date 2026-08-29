/**
 * DeepSeek's published per-model, per-million-token pricing.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing — check this
 * table against that page before changing a model's numbers or adding a new
 * one; a provider can reprice without announcing a version bump.
 */

export type DeepSeekModel = "deepseek-v4-flash" | "deepseek-v4-pro" | "deepseek-v4-flash-vision-exp";

export const DEFAULT_DEEPSEEK_MODEL: DeepSeekModel = "deepseek-v4-flash";

interface Rate {
  offPeak: number;
  peak: number;
}

interface ModelRates {
  /** USD per 1,000,000 tokens. */
  cacheHit: Rate;
  cacheMiss: Rate;
  output: Rate;
}

const RATES: Record<DeepSeekModel, ModelRates> = {
  "deepseek-v4-flash": {
    cacheHit: { offPeak: 0.007, peak: 0.014 },
    cacheMiss: { offPeak: 0.22, peak: 0.44 },
    output: { offPeak: 0.66, peak: 1.32 },
  },
  "deepseek-v4-pro": {
    cacheHit: { offPeak: 0.022, peak: 0.044 },
    cacheMiss: { offPeak: 0.66, peak: 1.32 },
    output: { offPeak: 1.98, peak: 3.96 },
  },
  // Same rate card as flash today — the vision surcharge, if any, is not
  // published separately. Revisit if DeepSeek splits it out.
  "deepseek-v4-flash-vision-exp": {
    cacheHit: { offPeak: 0.007, peak: 0.014 },
    cacheMiss: { offPeak: 0.22, peak: 0.44 },
    output: { offPeak: 0.66, peak: 1.32 },
  },
};

export function isDeepSeekModel(model: string): model is DeepSeekModel {
  return Object.hasOwn(RATES, model);
}

/**
 * Peak is 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday — DeepSeek charges
 * MORE in these windows, not less; they line up with Chinese business hours
 * (UTC+8), when demand on the API is highest. Every other time, including
 * both full weekend days, is off-peak at 50% of the peak rate.
 *
 * Boundaries are start-inclusive, end-exclusive (01:00 is peak, 04:00 is
 * not) — DeepSeek's docs don't state the boundary convention explicitly;
 * this is the standard reading and is only ever off by one hour's worth of
 * an estimate, never by an order of magnitude.
 */
export function isPeakHours(at: Date): boolean {
  const day = at.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6) return false;

  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

/**
 * Deliberately plain floating-point, not `Money` — see `LlmUsage.estimatedCostUsd`
 * for why a per-call USD estimate doesn't carry `Money`'s precision
 * requirement. An unrecognised model (one DeepSeek ships after this file was
 * last updated) returns "0.000000" rather than throwing: a call that
 * genuinely completed must not fail purely because pricing is stale.
 */
export function calculateDeepSeekCost(input: {
  model: string;
  cacheHitTokens: number;
  cacheMissTokens: number;
  completionTokens: number;
  at?: Date;
}): string {
  const { model, cacheHitTokens, cacheMissTokens, completionTokens, at = new Date() } = input;

  if (!isDeepSeekModel(model)) return "0.000000";

  const rates = RATES[model];
  const peak = isPeakHours(at);
  const perMillion = (rate: Rate) => (peak ? rate.peak : rate.offPeak);

  const cost =
    (cacheHitTokens / 1_000_000) * perMillion(rates.cacheHit) +
    (cacheMissTokens / 1_000_000) * perMillion(rates.cacheMiss) +
    (completionTokens / 1_000_000) * perMillion(rates.output);

  return cost.toFixed(6);
}

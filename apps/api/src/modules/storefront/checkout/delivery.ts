import type { Emirate, ShippingRate } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";

export type CourierUnavailableReason =
  | "NO_ADDRESS"
  | "EMIRATE_NOT_SERVED"
  | "PICKUP_ONLY_ITEMS"
  | "OVERWEIGHT"
  /** The store has no delivery line configured, so a fee could not be invoiced. */
  | "NOT_OFFERED";

export interface CourierQuote {
  available: boolean;
  reason?: CourierUnavailableReason;
  /** Net fee, Minor4. Zero when free or unavailable. */
  fee: bigint;
  etaDays: number;
  freeOver: bigint | null;
}

/**
 * What a courier delivery costs, net. Pure, so the rules are testable without
 * a database: the base fee covers `baseWeightKg`, each started kilogram above
 * it costs `perKgFee`, and the fee drops to zero at the free-delivery threshold
 * (measured on goods after any discount) or with a free-shipping code.
 */
export function courierQuote(input: {
  rates: ShippingRate[];
  emirate: Emirate | undefined;
  /** Minor4 kilograms. */
  weightKg: bigint;
  goodsNetAfterDiscount: bigint;
  hasPickupOnlyItems: boolean;
  freeShipping: boolean;
  deliveryConfigured: boolean;
}): CourierQuote {
  const none = (reason: CourierUnavailableReason, etaDays = 0): CourierQuote => ({
    available: false,
    reason,
    fee: 0n,
    etaDays,
    freeOver: null,
  });
  if (!input.deliveryConfigured) return none("NOT_OFFERED");
  if (input.hasPickupOnlyItems) return none("PICKUP_ONLY_ITEMS");
  if (!input.emirate) return none("NO_ADDRESS");

  const rate = input.rates.find((r) => r.emirate === input.emirate);
  if (!rate?.active) return none("EMIRATE_NOT_SERVED");

  // Started kilograms: 5.2 kg is charged as 6, 5.0 as 5. Minor4 is scaled by 10^4.
  const whole = input.weightKg / 10_000n;
  const kg = Number(input.weightKg % 10_000n === 0n ? whole : whole + 1n);
  if (kg > rate.maxWeightKg) return none("OVERWEIGHT", rate.etaDays);

  const freeOver = rate.freeOver ? Money.toMinor(rate.freeOver) : null;
  let fee = Money.add(
    Money.toMinor(rate.baseFee),
    Money.multiplyByQuantity(Money.toMinor(rate.perKgFee), String(Math.max(0, kg - rate.baseWeightKg))),
  );
  if (input.freeShipping || (freeOver !== null && input.goodsNetAfterDiscount >= freeOver)) fee = 0n;

  return { available: true, fee, etaDays: rate.etaDays, freeOver };
}

export interface PickupSlot {
  start: string;
  end: string;
  label: string;
}

/** The UTC offset of `timeZone` at `at`, in ms. Correct across DST for zones that have it. */
function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Pickup slots in the shop's own timezone, the earliest at least
 * `leadTimeHours` from now, covering `daysAhead` days that have any slot left.
 */
export function pickupSlots(
  now: Date,
  config: { slotMinutes: number; leadTimeHours: number; daysAhead: number; opensAt: string; closesAt: string },
  timeZone: string,
): PickupSlot[] {
  const earliest = now.getTime() + config.leadTimeHours * 3_600_000;
  const offset = offsetMs(timeZone, now);
  const local = new Date(now.getTime() + offset);
  const todayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset;

  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  const opens = minutesOf(config.opensAt);
  const closes = minutesOf(config.closesAt);
  const slots: (PickupSlot & { day: string })[] = [];

  // One extra day, in case today has nothing left.
  for (let d = 0; d <= config.daysAhead; d++) {
    const dayStart = todayStart + d * 86_400_000;
    for (let m = opens; m + config.slotMinutes <= closes; m += config.slotMinutes) {
      const start = dayStart + m * 60_000;
      if (start < earliest) continue;
      const end = start + config.slotMinutes * 60_000;
      const dayLabel = day.format(start);
      slots.push({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        label: `${dayLabel}, ${time.format(start)}–${time.format(end)}`,
        day: dayLabel,
      });
    }
  }
  const days = [...new Set(slots.map((s) => s.day))].slice(0, config.daysAhead);
  return slots.filter((s) => days.includes(s.day)).map(({ day: _day, ...slot }) => slot);
}

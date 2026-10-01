import { Injectable } from '@nestjs/common';
import type { Emirate } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export const DUBAI_OFFSET_MS = 4 * 3_600_000; // UAE is UTC+4 all year (no DST)

export type CourierUnavailableReason =
  | 'NO_ADDRESS'
  | 'EMIRATE_NOT_SERVED'
  | 'PICKUP_ONLY_ITEMS'
  | 'OVERWEIGHT';

export interface CourierOption {
  available: boolean;
  reason?: CourierUnavailableReason;
  feeNetFils: number;
  etaDays: number;
  freeOverFils: number | null;
}

export interface PickupSlot {
  start: string; // ISO
  end: string;
  label: string; // "Wed 1 Oct, 10:00–12:00"
}

/**
 * Pickup slots in Dubai local time, starting at least `leadHours` from now.
 * Pure function for testing.
 */
export function pickupSlots(
  now: Date,
  cfg: { leadHours: number; slotMinutes: number; daysAhead: number; openHour: number; closeHour: number },
): PickupSlot[] {
  const earliest = now.getTime() + cfg.leadHours * 3_600_000;
  const localNow = new Date(now.getTime() + DUBAI_OFFSET_MS);
  const dayStartUtc =
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) - DUBAI_OFFSET_MS;

  const fmtDay = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short',
  });
  const fmtTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const slots: PickupSlot[] = [];
  // One extra day in case today has no slots left.
  for (let d = 0; d <= cfg.daysAhead; d++) {
    const day = dayStartUtc + d * 86_400_000;
    for (
      let m = cfg.openHour * 60;
      m + cfg.slotMinutes <= cfg.closeHour * 60;
      m += cfg.slotMinutes
    ) {
      const start = day + m * 60_000;
      if (start < earliest) continue;
      const end = start + cfg.slotMinutes * 60_000;
      slots.push({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        label: `${fmtDay.format(start)}, ${fmtTime.format(start)}–${fmtTime.format(end)}`,
      });
    }
  }
  // Cover `daysAhead` distinct days that actually have slots.
  const days = [...new Set(slots.map((s) => s.label.split(',')[0]))].slice(0, cfg.daysAhead);
  return slots.filter((s) => days.includes(s.label.split(',')[0]));
}

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async courierOption(input: {
    emirate?: Emirate;
    weightGrams: number;
    subtotalNetFils: number; // after discount
    hasPickupOnlyItems: boolean;
    freeShipping?: boolean;
  }): Promise<CourierOption> {
    const none = (reason: CourierUnavailableReason, etaDays = 0): CourierOption => ({
      available: false, reason, feeNetFils: 0, etaDays, freeOverFils: null,
    });
    if (input.hasPickupOnlyItems) return none('PICKUP_ONLY_ITEMS');
    if (!input.emirate) return none('NO_ADDRESS');

    const rate = await this.prisma.shippingRate.findUnique({ where: { emirate: input.emirate } });
    if (!rate?.active) return none('EMIRATE_NOT_SERVED');

    const kg = Math.ceil(input.weightGrams / 1000);
    if (kg > rate.maxWeightKg) return none('OVERWEIGHT', rate.etaDays);

    let fee = rate.baseFils + Math.max(0, kg - rate.baseWeightKg) * rate.perKgFils;
    if (input.freeShipping) fee = 0;
    if (rate.freeOverFils != null && input.subtotalNetFils >= rate.freeOverFils) fee = 0;
    return { available: true, feeNetFils: fee, etaDays: rate.etaDays, freeOverFils: rate.freeOverFils };
  }

  async pickupBranches(now = new Date()) {
    const [branches, cfg] = await Promise.all([
      this.prisma.branch.findMany({
        where: { active: true, pickupEnabled: true },
        orderBy: { name: 'asc' },
      }),
      this.settings.get('pickup'),
    ]);
    const slots = pickupSlots(now, cfg);
    return branches.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      emirate: b.emirate,
      address: b.address,
      phone: b.phone,
      slots,
    }));
  }

  async isValidSlot(start: Date, now = new Date()) {
    const cfg = await this.settings.get('pickup');
    return pickupSlots(now, cfg).some((s) => new Date(s.start).getTime() === start.getTime());
  }
}

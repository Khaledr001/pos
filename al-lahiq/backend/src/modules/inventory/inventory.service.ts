import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export type StockLabel = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface BranchAvailability {
  branchId: string;
  branchCode: string;
  branchName: string;
  available: number; // base uom, after safety buffer
  label: StockLabel;
}

export interface VariantAvailability {
  variantId: string;
  available: number; // across all branches, base uom
  label: StockLabel;
  branches: BranchAvailability[];
}

export interface StockDeduction {
  variantId: string;
  branchId: string;
  qty: number;
}

export interface StockNeed {
  variantId: string;
  sku: string;
  baseQty: number; // quantity converted to base uom
}

const LOW_STOCK_AT = 5;

function label(available: number): StockLabel {
  if (available <= 0) return 'OUT_OF_STOCK';
  return available <= LOW_STOCK_AT ? 'LOW_STOCK' : 'IN_STOCK';
}

/**
 * Stock is a read-only copy of the POS. Online availability holds back a safety
 * buffer per branch so in-store sales can't oversell online.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async availability(variantIds: string[], tx?: Tx): Promise<Map<string, VariantAvailability>> {
    const db = tx ?? this.prisma;
    const { safetyBuffer } = await this.settings.get('stock', tx);
    const levels = await db.stockLevel.findMany({
      where: { variantId: { in: variantIds }, branch: { active: true } },
      include: { branch: true },
    });

    const map = new Map<string, VariantAvailability>();
    for (const id of variantIds) {
      map.set(id, { variantId: id, available: 0, label: 'OUT_OF_STOCK', branches: [] });
    }
    for (const l of levels) {
      const v = map.get(l.variantId)!;
      const available = Math.max(0, Number(l.quantity) - safetyBuffer);
      v.branches.push({
        branchId: l.branchId,
        branchCode: l.branch.code,
        branchName: l.branch.name,
        available,
        label: label(available),
      });
      v.available += available;
    }
    for (const v of map.values()) {
      v.label = label(v.available);
      v.branches.sort((a, b) => a.branchName.localeCompare(b.branchName));
    }
    return map;
  }

  /** Returns the SKUs that can't be supplied (from one branch for pickup, any branch for courier). */
  async shortages(needs: StockNeed[], pickupBranchId?: string, tx?: Tx) {
    const avail = await this.availability(needs.map((n) => n.variantId), tx);
    return needs
      .map((n) => {
        const a = avail.get(n.variantId);
        const available = pickupBranchId
          ? (a?.branches.find((b) => b.branchId === pickupBranchId)?.available ?? 0)
          : (a?.available ?? 0);
        return { ...n, available };
      })
      .filter((n) => n.available + 1e-9 < n.baseQty);
  }

  /**
   * Deducts stock from the local copy when an order is placed, so the next
   * shopper sees it straight away. The POS is still the source of truth: its
   * next stock.updated event (with a higher version) overwrites these rows.
   */
  async deductForOrder(
    tx: Tx,
    needs: StockNeed[],
    pickupBranchId?: string,
  ): Promise<StockDeduction[]> {
    const { fulfilmentBranchCode, safetyBuffer } = await this.settings.get('stock', tx);
    const deductions: StockDeduction[] = [];

    for (const need of needs) {
      let remaining = need.baseQty;
      const levels = await tx.stockLevel.findMany({
        where: {
          variantId: need.variantId,
          branch: { active: true },
          ...(pickupBranchId ? { branchId: pickupBranchId } : {}),
        },
        include: { branch: { select: { code: true } } },
        orderBy: { quantity: 'desc' },
      });
      // Courier orders ship from the fulfilment branch first.
      levels.sort((a, b) =>
        a.branch.code === fulfilmentBranchCode ? -1 : b.branch.code === fulfilmentBranchCode ? 1 : 0,
      );

      for (const level of levels) {
        if (remaining <= 1e-9) break;
        const take = Math.min(remaining, Math.max(0, Number(level.quantity) - safetyBuffer));
        if (take <= 0) continue;
        // Conditional update guards against a concurrent checkout.
        const updated = await tx.stockLevel.updateMany({
          where: {
            variantId: level.variantId,
            branchId: level.branchId,
            quantity: { gte: new Prisma.Decimal(take + safetyBuffer) },
          },
          data: { quantity: { decrement: new Prisma.Decimal(take) } },
        });
        if (updated.count === 1) {
          remaining -= take;
          deductions.push({ variantId: level.variantId, branchId: level.branchId, qty: take });
        }
      }

      if (remaining > 1e-9) {
        throw ApiError.conflict('OUT_OF_STOCK', `Not enough stock for ${need.sku}`, {
          sku: need.sku,
        });
      }
    }
    return deductions;
  }

  /** Puts back what deductForOrder took (cancelled or unpaid orders). */
  async restore(tx: Tx, deductions: StockDeduction[]) {
    for (const d of deductions) {
      await tx.stockLevel.updateMany({
        where: { variantId: d.variantId, branchId: d.branchId },
        data: { quantity: { increment: new Prisma.Decimal(d.qty) } },
      });
    }
  }
}

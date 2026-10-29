import { and, asc, count, eq, isNull, schema } from "@devsfleet/db";
import type { Brand, Unit } from "@devsfleet/db";
import { DEFAULT_UNIT_CODE } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, slugify } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateBrandDto, CreateUnitDto, UpdateBrandDto, UpdateUnitDto } from "./dto.js";

/**
 * Unit abbreviations → the UN/ECE code the e-invoice sends for them.
 *
 * Packaging units (box, pack, roll) use the Recommendation 21 codes with their
 * X prefix (XBX, XPK, XRO): the official PINT AE validation rejects the bare
 * Rec 20 forms BX, PK and ROL. Every value here must be in UNIT_CODE_PRESETS
 * (or be a 3-character upper-case code) — a spec asserts it.
 */
export const ABBREVIATION_UNIT_CODES: Readonly<Record<string, string>> = {
  m: "MTR",
  mtr: "MTR",
  meter: "MTR",
  metre: "MTR",
  kg: "KGM",
  kgs: "KGM",
  g: "GRM",
  gm: "GRM",
  l: "LTR",
  ltr: "LTR",
  litre: "LTR",
  liter: "LTR",
  ml: "MLT",
  box: "XBX",
  bx: "XBX",
  pack: "XPK",
  pk: "XPK",
  roll: "XRO",
  rol: "XRO",
  set: "SET",
  pair: "PR",
  pr: "PR",
  sqm: "MTK",
  m2: "MTK",
  m3: "MTQ",
  hr: "HUR",
  hour: "HUR",
};

/**
 * The UN/ECE code a unit most likely means, from what it is called.
 * Only a starting point: the owner can set it explicitly, and an unrecognised
 * abbreviation falls back to C62 ("one" — each / piece), which is always valid.
 */
export function inferUnitCode(abbreviation: string): string {
  return ABBREVIATION_UNIT_CODES[abbreviation.trim().toLowerCase().replace(/\./g, "")] ?? DEFAULT_UNIT_CODE;
}

/**
 * Brands and units.
 *
 * Together because they are the same shape: small reference lists that
 * products point at, where the only real logic is refusing to delete one that
 * is still in use. Splitting them into two modules would triple the wiring for
 * no separation worth having.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly db: TenantDatabase) {}

  // ---------------------------------------------------------------------------
  // Brands
  // ---------------------------------------------------------------------------

  async listBrands(includeInactive = false): Promise<unknown[]> {
    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.brands.id,
          name: schema.brands.name,
          slug: schema.brands.slug,
          logoUrl: schema.brands.logoUrl,
          isActive: schema.brands.isActive,
        })
        .from(schema.brands)
        .where(
          and(
            isNull(schema.brands.deletedAt),
            includeInactive ? undefined : eq(schema.brands.isActive, true),
          ),
        )
        .orderBy(asc(schema.brands.name)),
    );
  }

  async createBrand(dto: CreateBrandDto): Promise<Brand> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [brand] = await tx
        .insert(schema.brands)
        .values({
          tenantId,
          name: dto.name,
          slug: slugify(dto.name),
          ...(dto.logoUrl ? { logoUrl: dto.logoUrl } : {}),
        })
        .returning();

      if (!brand) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the brand");
      return brand;
    });
    // A duplicate slug raises 23505 on uq_brands_tenant_slug, which the filter
    // turns into a 409. No pre-flight SELECT — that is a race, the index is not.
  }

  async updateBrand(id: string, dto: UpdateBrandDto): Promise<Brand> {
    return this.db.run(async (tx) => {
      const [brand] = await tx
        .update(schema.brands)
        .set({
          ...(dto.name !== undefined ? { name: dto.name, slug: slugify(dto.name) } : {}),
          ...(dto.logoUrl !== undefined ? { logoUrl: dto.logoUrl } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        })
        .where(and(eq(schema.brands.id, id), isNull(schema.brands.deletedAt)))
        .returning();

      if (!brand) throw new AppError(ERROR_CODES.NOT_FOUND, `Brand ${id} not found`);
      return brand;
    });
  }

  async removeBrand(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [inUse] = await tx
        .select({ value: count() })
        .from(schema.products)
        .where(and(eq(schema.products.brandId, id), isNull(schema.products.deletedAt)));

      if ((inUse?.value ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${inUse!.value} products use this brand. Reassign them first.`,
        );
      }

      const [deleted] = await tx
        .update(schema.brands)
        .set({ deletedAt: new Date(), isActive: false })
        .where(and(eq(schema.brands.id, id), isNull(schema.brands.deletedAt)))
        .returning({ id: schema.brands.id });

      if (!deleted) throw new AppError(ERROR_CODES.NOT_FOUND, `Brand ${id} not found`);
    });
  }

  // ---------------------------------------------------------------------------
  // Units
  // ---------------------------------------------------------------------------

  async listUnits(): Promise<Unit[]> {
    return this.db.run(async (tx) =>
      tx.select().from(schema.units).orderBy(asc(schema.units.name)),
    );
  }

  async createUnit(dto: CreateUnitDto): Promise<Unit> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [unit] = await tx
        .insert(schema.units)
        .values({
          tenantId,
          name: dto.name,
          abbreviation: dto.abbreviation,
          allowsFractions: dto.allowsFractions,
          unitCode: dto.unitCode ?? inferUnitCode(dto.abbreviation),
        })
        .returning();

      if (!unit) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the unit");
      return unit;
    });
  }

  /**
   * `allowsFractions` is deliberately not editable.
   *
   * Turning it off once stock exists in halves would make every existing
   * fractional balance invalid, with no sensible way to round it — and rounding
   * stock silently is how a warehouse count stops matching the system.
   */
  async updateUnit(id: string, dto: UpdateUnitDto): Promise<Unit> {
    return this.db.run(async (tx) => {
      const [unit] = await tx
        .update(schema.units)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.abbreviation !== undefined ? { abbreviation: dto.abbreviation } : {}),
          ...(dto.unitCode !== undefined ? { unitCode: dto.unitCode } : {}),
        })
        .where(eq(schema.units.id, id))
        .returning();

      if (!unit) throw new AppError(ERROR_CODES.NOT_FOUND, `Unit ${id} not found`);
      return unit;
    });
  }

  async removeUnit(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [inUse] = await tx
        .select({ value: count() })
        .from(schema.products)
        .where(and(eq(schema.products.unitId, id), isNull(schema.products.deletedAt)));

      if ((inUse?.value ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${inUse!.value} products are measured in this unit. Reassign them first.`,
        );
      }

      const [remaining] = await tx.select({ value: count() }).from(schema.units);
      if ((remaining?.value ?? 0) <= 1) {
        // Every product needs a unit, so a tenant with none cannot add one.
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This is the only unit. Create another before deleting it.",
        );
      }

      await tx.delete(schema.units).where(eq(schema.units.id, id));
    });
  }
}

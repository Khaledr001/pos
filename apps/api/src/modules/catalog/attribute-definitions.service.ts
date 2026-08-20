import { asc, count, eq, schema } from "@devsfleet/db";
import type { AttributeDefinition } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateAttributeDefinitionDto, UpdateAttributeDefinitionDto } from "./dto.js";

/**
 * Typed variant attributes (Stage 5.3): one category's own vocabulary — the
 * "size"/"colour" a Plumbing variant carries mean nothing on a Paint one, so
 * a definition is scoped to a single category rather than shared globally.
 *
 * Values live in `variant_attribute_values`, written by ProductsService
 * alongside the existing free-form `attributes` JSONB — this table only
 * defines what a value is ALLOWED to be, never holds one itself.
 */
@Injectable()
export class AttributeDefinitionsService {
  constructor(private readonly db: TenantDatabase) {}

  async listForCategory(categoryId: string): Promise<AttributeDefinition[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(schema.attributeDefinitions)
        .where(eq(schema.attributeDefinitions.categoryId, categoryId))
        .orderBy(asc(schema.attributeDefinitions.sortOrder), asc(schema.attributeDefinitions.label)),
    );
  }

  async create(dto: CreateAttributeDefinitionDto): Promise<AttributeDefinition> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [definition] = await tx
        .insert(schema.attributeDefinitions)
        .values({
          tenantId,
          categoryId: dto.categoryId,
          name: dto.name,
          label: dto.label,
          type: dto.type,
          unit: dto.unit ?? null,
          allowedValues: dto.type === "select" ? dto.allowedValues : null,
          sortOrder: dto.sortOrder,
        })
        .returning();

      if (!definition) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the attribute");
      }
      return definition;
    });
    // A duplicate (categoryId, name) raises 23505 on
    // uq_attribute_definitions_category_name, which the exception filter
    // turns into a 409. No pre-flight SELECT — that is a race, the index is not.
  }

  async update(id: string, dto: UpdateAttributeDefinitionDto): Promise<AttributeDefinition> {
    return this.db.run(async (tx) => {
      const [definition] = await tx
        .update(schema.attributeDefinitions)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.unit !== undefined ? { unit: dto.unit ?? null } : {}),
          ...(dto.allowedValues !== undefined ? { allowedValues: dto.allowedValues } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        })
        .where(eq(schema.attributeDefinitions.id, id))
        .returning();

      if (!definition) throw new AppError(ERROR_CODES.NOT_FOUND, `Attribute ${id} not found`);
      return definition;
    });
  }

  /**
   * A real delete — this row is pure configuration, like a packaging
   * (variant_units). Refused while any variant still carries a value for it,
   * rather than cascading the values away silently.
   */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [inUse] = await tx
        .select({ value: count() })
        .from(schema.variantAttributeValues)
        .where(eq(schema.variantAttributeValues.attributeDefinitionId, id));

      if ((inUse?.value ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${inUse!.value} variant(s) carry a value for this attribute. Remove them first.`,
        );
      }

      const [deleted] = await tx
        .delete(schema.attributeDefinitions)
        .where(eq(schema.attributeDefinitions.id, id))
        .returning({ id: schema.attributeDefinitions.id });

      if (!deleted) throw new AppError(ERROR_CODES.NOT_FOUND, `Attribute ${id} not found`);
    });
  }
}

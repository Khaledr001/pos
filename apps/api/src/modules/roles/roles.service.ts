import { count, eq, schema } from "@devsfleet/db";
import type { PermissionGrant } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertMayGrantPermissions } from "../../common/context/authority.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateRoleDto, UpdateRoleDto } from "./dto.js";

/**
 * Roles: named, reusable permission sets. `role:write` is the one permission
 * this whole service exists to protect — every write here runs through
 * `assertMayGrantPermissions`, so nobody can hand a role more access than
 * they hold themselves, whether creating it fresh or editing an existing
 * one's array.
 */
@Injectable()
export class RolesService {
  constructor(private readonly db: TenantDatabase) {}

  async list() {
    return this.db.run((tx) => tx.select().from(schema.roles).orderBy(schema.roles.name));
  }

  async findById(id: string) {
    return this.db.run(async (tx) => {
      const [role] = await tx.select().from(schema.roles).where(eq(schema.roles.id, id));
      if (!role) throw new AppError(ERROR_CODES.NOT_FOUND, `Role ${id} not found`);
      return role;
    });
  }

  async create(dto: CreateRoleDto) {
    assertMayGrantPermissions(dto.permissions as PermissionGrant[], `Role "${dto.name}"`);
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [existing] = await tx.select().from(schema.roles).where(eq(schema.roles.name, dto.name));
      if (existing) {
        throw new AppError(ERROR_CODES.CONFLICT, `A role named "${dto.name}" already exists.`);
      }

      const [role] = await tx
        .insert(schema.roles)
        .values({
          tenantId,
          name: dto.name,
          ...(dto.description ? { description: dto.description } : {}),
          permissions: dto.permissions as PermissionGrant[],
        })
        .returning();

      return role;
    });
  }

  async update(id: string, dto: UpdateRoleDto) {
    return this.db.run(async (tx) => {
      const [existing] = await tx.select().from(schema.roles).where(eq(schema.roles.id, id));
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Role ${id} not found`);

      if (dto.permissions) {
        assertMayGrantPermissions(dto.permissions as PermissionGrant[], `Role "${existing.name}"`);
      }
      if (dto.name && dto.name !== existing.name) {
        const [duplicate] = await tx.select().from(schema.roles).where(eq(schema.roles.name, dto.name));
        if (duplicate) {
          throw new AppError(ERROR_CODES.CONFLICT, `A role named "${dto.name}" already exists.`);
        }
      }

      const [role] = await tx
        .update(schema.roles)
        .set({
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.permissions ? { permissions: dto.permissions as PermissionGrant[] } : {}),
        })
        .where(eq(schema.roles.id, id))
        .returning();

      return role;
    });
  }

  /** A real delete — nothing snapshots a role the way a document snapshots a price. */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const [existing] = await tx.select().from(schema.roles).where(eq(schema.roles.id, id));
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Role ${id} not found`);

      if (existing.isSystem) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          "Seeded roles cannot be deleted. Edit its permissions instead.",
        );
      }

      const [inUse] = await tx
        .select({ value: count() })
        .from(schema.users)
        .where(eq(schema.users.roleId, id));

      if ((inUse?.value ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${inUse?.value} staff member(s) still hold this role. Reassign them first.`,
        );
      }

      await tx.delete(schema.roles).where(eq(schema.roles.id, id));
    });
  }
}

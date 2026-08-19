import { and, eq, inArray, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, branchScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateDeviceDto, ListDevicesDto, UpdateDeviceDto } from "./dto.js";

@Injectable()
export class DevicesService {
  constructor(private readonly db: TenantDatabase) {}

  async list(query: ListDevicesDto) {
    if (query.branchId) assertBranchInScope(query.branchId);

    // Without the scope clause an unfiltered call — which is what the UI sends
    // by default — listed every terminal in the business to a manager who runs
    // one shop.
    const scope = branchScope();
    const where = and(
      query.branchId ? eq(schema.devices.branchId, query.branchId) : undefined,
      scope ? inArray(schema.devices.branchId, scope) : undefined,
    );

    return this.db.run(async (tx) =>
      tx.select().from(schema.devices).where(where).orderBy(schema.devices.name),
    );
  }

  async findById(id: string) {
    return this.db.run(async (tx) => {
      const [device] = await tx
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.id, id));

      if (!device) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Device not found");
      }
      assertBranchInScope(device.branchId);
      return device;
    });
  }

  async create(dto: CreateDeviceDto) {
    assertBranchInScope(dto.branchId);

    return this.db.run(async (tx) => {
      const [branch] = await tx
        .select()
        .from(schema.branches)
        .where(eq(schema.branches.id, dto.branchId));
        
      if (!branch) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Branch not found");
      }

      const [existingName] = await tx
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.name, dto.name));
        
      if (existingName) {
        throw new AppError(ERROR_CODES.CONFLICT, `Device name '${dto.name}' is already in use`);
      }

      if (dto.hardwareId) {
        const [existingHardware] = await tx
          .select()
          .from(schema.devices)
          .where(eq(schema.devices.hardwareId, dto.hardwareId));
          
        if (existingHardware) {
          throw new AppError(ERROR_CODES.CONFLICT, "Hardware ID already registered");
        }
      }

      const tenantId = RequestContext.requireTenantId();
      const [device] = await tx
        .insert(schema.devices)
        .values({
          tenantId,
          branchId: dto.branchId,
          name: dto.name,
          type: "pos",
          hardwareId: dto.hardwareId,
          activatedAt: new Date(),
        })
        .returning();

      return device;
    });
  }

  async update(id: string, dto: UpdateDeviceDto) {
    return this.db.run(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.id, id));
        
      if (!existing) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Device not found");
      }
      // Deactivating a terminal ends every session on it, so it is a branch
      // action, not a global one.
      assertBranchInScope(existing.branchId);

      if (dto.name && dto.name !== existing.name) {
        const [existingName] = await tx
          .select()
          .from(schema.devices)
          .where(eq(schema.devices.name, dto.name));
          
        if (existingName) {
          throw new AppError(ERROR_CODES.CONFLICT, `Device name '${dto.name}' is already in use`);
        }
      }

      const [updated] = await tx
        .update(schema.devices)
        .set({
          ...(dto.name && { name: dto.name }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          updatedAt: new Date(),
        })
        .where(eq(schema.devices.id, id))
        .returning();

      return updated;
    });
  }
}

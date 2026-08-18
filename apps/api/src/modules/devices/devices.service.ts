import { and, eq, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateDeviceDto, ListDevicesDto, UpdateDeviceDto } from "./dto.js";

@Injectable()
export class DevicesService {
  constructor(private readonly db: TenantDatabase) {}

  async list(query: ListDevicesDto) {
    return this.db.run(async (tx) => {
      let q = tx.select().from(schema.devices);
      
      if (query.branchId) {
        // Drizzle builder doesn't let us conditionally append where easily without a builder instance,
        // but since we only have one optional filter, we can just do this:
        return tx
          .select()
          .from(schema.devices)
          .where(eq(schema.devices.branchId, query.branchId))
          .orderBy(schema.devices.name);
      }

      return tx.select().from(schema.devices).orderBy(schema.devices.name);
    });
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
      return device;
    });
  }

  async create(dto: CreateDeviceDto) {
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

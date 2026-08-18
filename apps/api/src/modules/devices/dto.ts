import { z } from "zod";

export const CreateDeviceSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  branchId: z.string().uuid("Invalid branch ID"),
  hardwareId: z.string().max(128).optional(),
});
export type CreateDeviceDto = z.infer<typeof CreateDeviceSchema>;

export const ListDevicesSchema = z.object({
  branchId: z.string().uuid().optional(),
});
export type ListDevicesDto = z.infer<typeof ListDevicesSchema>;

export const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDeviceDto = z.infer<typeof UpdateDeviceSchema>;

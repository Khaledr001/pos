import { PERMISSIONS, SUPERUSER_PERMISSION } from "@devsfleet/shared-types";
import { z } from "zod";

const PermissionGrantSchema = z.enum([...PERMISSIONS, SUPERUSER_PERMISSION] as [string, ...string[]]);

export const CreateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(PermissionGrantSchema).default([]),
});
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.array(PermissionGrantSchema).optional(),
});
export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;

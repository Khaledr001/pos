import { Module } from '@nestjs/common';
import { AdminCatalogService } from './admin-catalog.service.js';
import { AdminOpsService } from './admin-ops.service.js';
import {
  AdminCatalogController,
  AdminContentController,
  AdminCustomersController,
  AdminOrdersController,
  AdminSettingsController,
  AdminStaffController,
  AdminSyncController,
} from './admin.controllers.js';

@Module({
  controllers: [
    AdminCatalogController,
    AdminOrdersController,
    AdminCustomersController,
    AdminContentController,
    AdminSettingsController,
    AdminStaffController,
    AdminSyncController,
  ],
  providers: [AdminCatalogService, AdminOpsService],
})
export class AdminModule {}

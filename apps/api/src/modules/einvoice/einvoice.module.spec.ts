import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { EinvoiceAdminController } from "./einvoice-admin.controller.js";
import { EinvoiceCallbackController } from "./einvoice-callback.controller.js";
import { EinvoiceEnqueueService } from "./einvoice-enqueue.service.js";
import { EinvoiceModule } from "./einvoice.module.js";
import { EinvoiceSweepService } from "./einvoice-sweep.service.js";

/** Stands in for the app's global DatabaseModule and ConfigModule. */
@Global()
@Module({
  providers: [
    { provide: TenantDatabase, useValue: {} },
    { provide: ConfigService, useValue: { get: (key: string) => (key === "NODE_ENV" ? "test" : undefined) } },
  ],
  exports: [TenantDatabase, ConfigService],
})
class GlobalsStub {}

describe("EinvoiceModule wiring", () => {
  it("resolves every provider and controller (a missing injection would otherwise only show at boot)", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GlobalsStub, EinvoiceModule] }).compile();
    expect(moduleRef.get(EinvoiceEnqueueService)).toBeInstanceOf(EinvoiceEnqueueService);
    expect(moduleRef.get(EinvoiceSweepService)).toBeDefined();
    expect(moduleRef.get(EinvoiceAdminController)).toBeDefined();
    expect(moduleRef.get(EinvoiceCallbackController)).toBeDefined();
    await moduleRef.close();
  });
});

import { Module } from "@nestjs/common";
import { SecretBoxService } from "../../common/crypto/secret-box.service.js";
import { EinvoiceAdminController } from "./einvoice-admin.controller.js";
import { EinvoiceCallbackController } from "./einvoice-callback.controller.js";
import { EinvoiceCallbackService } from "./einvoice-callback.service.js";
import { EinvoiceDocumentsService } from "./einvoice-documents.service.js";
import { EinvoiceEnqueueService } from "./einvoice-enqueue.service.js";
import { EinvoiceSettingsService } from "./einvoice-settings.service.js";
import { EinvoiceSweepService } from "./einvoice-sweep.service.js";
import { ProviderResolver } from "./provider-resolver.js";

/**
 * UAE e-invoicing (PINT AE over Peppol, through an accredited service provider).
 * See docs/EINVOICING.md. The sales code uses only `EinvoiceEnqueueService`.
 */
@Module({
  controllers: [EinvoiceAdminController, EinvoiceCallbackController],
  providers: [SecretBoxService, ProviderResolver, EinvoiceEnqueueService, EinvoiceSweepService, EinvoiceDocumentsService, EinvoiceSettingsService, EinvoiceCallbackService],
  exports: [EinvoiceEnqueueService],
})
export class EinvoiceModule {}

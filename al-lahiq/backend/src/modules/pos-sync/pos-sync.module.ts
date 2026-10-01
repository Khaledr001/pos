import { Global, Module } from '@nestjs/common';
import { InboundService } from './inbound.service.js';
import { OutboxService } from './outbox.service.js';
import { PosClient } from './pos-client.js';
import { PosEventHandler } from './pos-event-handler.service.js';
import { PosSignatureGuard } from './pos-signature.guard.js';
import { PosWebhookController } from './pos-webhook.controller.js';
import { ReconciliationService } from './reconciliation.service.js';

/** Outbound half: used by orders/customers to queue events for the POS. */
@Global()
@Module({
  providers: [OutboxService, PosClient],
  exports: [OutboxService, PosClient],
})
export class OutboxModule {}

/** Inbound half: webhooks, event handling and nightly reconciliation. */
@Global()
@Module({
  controllers: [PosWebhookController],
  providers: [PosEventHandler, InboundService, ReconciliationService, PosSignatureGuard],
  exports: [PosEventHandler, InboundService, ReconciliationService],
})
export class PosSyncModule {}

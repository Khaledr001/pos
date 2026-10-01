import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PosEventHandler } from '../src/modules/pos-sync/pos-event-handler.service.js';
import { OutboxService } from '../src/modules/pos-sync/outbox.service.js';
import { ReconciliationService } from '../src/modules/pos-sync/reconciliation.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, MockPos, posEvent, resetDb, seedCatalog, startMockPos } from './helpers.js';

let app: INestApplication;
let prisma: PrismaService;
let pos: MockPos;

const contact = { fullName: 'Test Buyer', email: 'buyer@example.com', phone: '+971501112233' };
const address = { fullName: 'Test Buyer', phone: '+971501112233', emirate: 'DUBAI', area: 'JLT', street: 'Cluster D' };

beforeAll(async () => {
  pos = await startMockPos();
  process.env.POS_BASE_URL = pos.url;
  app = await createApp();
  await resetDb(app);
  prisma = await seedCatalog(app);
});

afterAll(async () => {
  await app?.close();
  await pos?.close();
});

const http = () => request(app.getHttpServer());

/** A shopper with their own cookie jar. */
function shopper() {
  return request.agent(app.getHttpServer());
}

async function variantId(sku: string) {
  return (await prisma.variant.findUniqueOrThrow({ where: { sku } })).id;
}

describe('POS webhooks', () => {
  it('rejects a bad signature with 401', async () => {
    const res = await http()
      .post('/api/v1/pos/webhooks')
      .set('x-al-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('x-al-signature', 'sha256=deadbeef')
      .send({ eventId: 'x', type: 'stock.updated', data: {} });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_SIGNATURE');
  });

  it('acknowledges a duplicate eventId without applying it twice', async () => {
    const data = { sku: 'TAP-1', branchCode: 'MAIN', quantity: 12, version: 5 };
    const first = await posEvent(app, 'stock.updated', data, 'dup-1').expect(202);
    const again = await posEvent(app, 'stock.updated', data, 'dup-1').expect(202);
    expect(first.body.status).toBe('accepted');
    expect(again.body.status).toBe('duplicate');
    expect(await prisma.inboundEvent.count({ where: { eventId: 'dup-1' } })).toBe(1);
  });

  it('ignores an event older than what it already has', async () => {
    await posEvent(app, 'stock.updated', { sku: 'TAP-1', branchCode: 'MAIN', quantity: 3, version: 4 }).expect(202);
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'TAP-1' } } });
    expect(Number(level.quantity)).toBe(12);
    expect(level.posVersion).toBe(5);
  });

  it('marks an invalid payload as FAILED', async () => {
    await posEvent(app, 'product.upsert', { sku: 'NO-NAME' }, 'bad-1').expect(202);
    const e = await prisma.inboundEvent.findUniqueOrThrow({ where: { eventId: 'bad-1' } });
    expect(e.status).toBe('FAILED');
    expect(e.error).toContain('Invalid payload');
  });
});

describe('catalog', () => {
  it('shows VAT-inclusive prices, units and stock', async () => {
    const res = await http().get('/api/v1/catalog/products/cable-2-5mm').expect(200);
    const v = res.body.variants[0];
    expect(v.units.map((u: { uom: string }) => u.uom)).toEqual(['m', 'roll']);
    expect(v.units[0].price.unit.fils).toBe(158); // 1.50 + 5% (rounded)
    expect(v.units[1].price.unit.fils).toBe(13_650); // 100 m at the 100 m break: 130 × 100 × 1.05
    expect(v.availability.label).toBe('IN_STOCK');
  });
});

describe('checkout', () => {
  it('stops the order when a price changed, then places it at the new price', async () => {
    const agent = shopper();
    await agent.post('/api/v1/cart/items').send({ variantId: await variantId('TAP-1'), quantity: 2 }).expect(201);

    // The POS changes the retail price after the item went into the cart.
    await posEvent(app, 'price_items.changed', {
      priceListCode: 'RETAIL',
      version: 3,
      upsert: [{ sku: 'TAP-1', uom: 'pc', minQty: 1, netPriceFils: 11_000 }],
    }).expect(202);

    const body = { deliveryMethod: 'COURIER', paymentMethod: 'COD', contact, address };
    const conflict = await agent.post('/api/v1/checkout/place').send(body).expect(409);
    expect(conflict.body.code).toBe('PRICE_CHANGED');
    expect(conflict.body.details.skus).toEqual(['TAP-1']);

    const placed = await agent.post('/api/v1/checkout/place').send(body).expect(201);
    expect(placed.body.next.type).toBe('confirmation');

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: placed.body.orderId },
      include: { lines: true, invoice: true },
    });
    expect(order.status).toBe('PLACED');
    expect(order.lines[0].unitNetFils).toBe(11_000);
    expect(order.subtotalNetFils).toBe(22_000);
    expect(order.shippingNetFils).toBe(2_000);
    expect(order.vatFils).toBe(1_200); // 5% of (220 + 20)
    expect(order.totalFils).toBe(25_200);
    expect(order.invoice?.invoiceNumber).toMatch(/^INV-\d{4}-000001$/);

    // Stock came off the local copy straight away.
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'TAP-1' } } });
    expect(Number(level.quantity)).toBe(10);
  });

  it('sends order.created to the POS, signed, with the charged prices', async () => {
    const event = pos.events.find((e) => e.type === 'order.created');
    expect(event).toBeDefined();
    expect(event!.signatureValid).toBe(true);
    expect(event!.data.lines[0]).toMatchObject({ sku: 'TAP-1', quantity: 2, unitNetPriceFils: 11_000, priceListCode: 'RETAIL' });
    const outbox = await prisma.outboxEvent.findFirstOrThrow({ where: { type: 'order.created' } });
    expect(outbox.status).toBe('SENT');
  });

  it('retries outbox events when the POS is down', async () => {
    const outbox = app.get(OutboxService);
    const id = await prisma.$transaction((tx) => outbox.add(tx, 'order.status_changed', 'x', { orderNumber: 'AL-X', status: 'CONFIRMED' }));
    pos.failNext = 1;
    await outbox.dispatch(id);
    let row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);

    await prisma.outboxEvent.update({ where: { id }, data: { nextAttemptAt: new Date() } });
    await outbox.dispatch(id);
    row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('SENT');
  });

  it('refuses to oversell (safety buffer of 2 applies)', async () => {
    const agent = shopper();
    await agent.post('/api/v1/cart/items').send({ variantId: await variantId('TAP-1'), quantity: 9 }).expect(201);
    const quote = await agent.post('/api/v1/checkout/quote').send({ deliveryMethod: 'COURIER', emirate: 'DUBAI' }).expect(200);
    expect(quote.body.canPlace).toBe(false);
    expect(quote.body.issues[0].code).toBe('OUT_OF_STOCK');
    const res = await agent
      .post('/api/v1/checkout/place')
      .send({ deliveryMethod: 'COURIER', paymentMethod: 'COD', contact, address });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OUT_OF_STOCK');
  });

  it('pays by card through the gateway and places the order on the webhook', async () => {
    const agent = shopper();
    await agent.post('/api/v1/cart/items').send({ variantId: await variantId('CAB-25'), uom: 'roll', quantity: 1 }).expect(201);
    const placed = await agent
      .post('/api/v1/checkout/place')
      .send({ deliveryMethod: 'COURIER', paymentMethod: 'CARD', contact, address })
      .expect(201);
    expect(placed.body.next.type).toBe('redirect');
    const ref = new URL(placed.body.next.url).searchParams.get('ref')!;

    let order = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.orderId } });
    expect(order.status).toBe('PENDING_PAYMENT');

    await http().post(`/api/v1/payments/dev/${ref}/complete`).send({ outcome: 'success' }).expect(200);
    await http().post(`/api/v1/payments/dev/${ref}/complete`).send({ outcome: 'success' }).expect(200); // idempotent
    order = await prisma.order.findUniqueOrThrow({ where: { id: placed.body.orderId } });
    expect(order.status).toBe('PLACED');
    expect(order.paymentStatus).toBe('PAID');
    expect(pos.events.filter((e) => e.type === 'order.created')).toHaveLength(2);
  });

  it('gives an unpaid order its stock back when it is cancelled', async () => {
    const agent = shopper();
    const before = Number((await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'CAB-25' } } })).quantity);
    await agent.post('/api/v1/cart/items').send({ variantId: await variantId('CAB-25'), quantity: 50 }).expect(201);
    const placed = await agent
      .post('/api/v1/checkout/place')
      .send({ deliveryMethod: 'COURIER', paymentMethod: 'CARD', contact, address })
      .expect(201);
    const mid = Number((await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'CAB-25' } } })).quantity);
    expect(mid).toBe(before - 50);

    await prisma.order.update({ where: { id: placed.body.orderId }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    const { OrdersService } = await import('../src/modules/orders/orders.service.js');
    await app.get(OrdersService).expireUnpaid(60);
    const after = Number((await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'CAB-25' } } })).quantity);
    expect(after).toBe(before);
  });
});

describe('trade customers', () => {
  it('see their price list once the POS assigns it', async () => {
    const agent = shopper();
    await agent
      .post('/api/v1/auth/register')
      .send({ email: 'omar@example.com', password: 'longpassword', firstName: 'Omar', lastName: 'H' })
      .expect(201);
    await posEvent(app, 'price_items.changed', {
      priceListCode: 'TRADE-A',
      version: 2,
      upsert: [{ sku: 'TAP-1', uom: 'pc', minQty: 1, netPriceFils: 9_000 }],
    }).expect(202);
    await posEvent(app, 'customer_price_list.assigned', { customerEmail: 'omar@example.com', priceListCodes: ['TRADE-A'] }).expect(202);

    const mine = await agent.get('/api/v1/catalog/prices?skus=TAP-1').expect(200);
    expect(mine.body['TAP-1'][0].price.unitNet.fils).toBe(9_000);
    expect(mine.body['TAP-1'][0].price.discounted).toBe(true);

    const anon = await http().get('/api/v1/catalog/prices?skus=TAP-1').expect(200);
    expect(anon.body['TAP-1'][0].price.unitNet.fils).toBe(11_000);

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.type).toBe('TRADE');
  });
});

describe('auth', () => {
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const agent = shopper();
    const login = await agent.post('/api/v1/auth/login').send({ email: 'omar@example.com', password: 'longpassword' }).expect(200);
    const oldRefresh = (login.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('al_rt='))!.split(';')[0];

    await agent.post('/api/v1/auth/refresh').expect(200);
    // Replaying the rotated token looks like theft: everything is revoked.
    await http().post('/api/v1/auth/refresh').set('cookie', oldRefresh).expect(401);
    await agent.post('/api/v1/auth/refresh').expect(401);
  });

  it('rejects wrong passwords with a generic message', async () => {
    const res = await http().post('/api/v1/auth/login').send({ email: 'omar@example.com', password: 'nope' }).expect(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('reconciliation', () => {
  it('fixes stock and price drift from the nightly snapshot', async () => {
    // Local copy drifts: someone edited stock and a price row went missing.
    await prisma.stockLevel.updateMany({ where: { variant: { sku: 'TAP-1' } }, data: { quantity: 1 } });
    const level = await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'TAP-1' } } });
    const retail = await prisma.priceList.findUniqueOrThrow({ where: { code: 'RETAIL' } });

    pos.snapshot = {
      products: [],
      stock: [{ sku: 'TAP-1', branchCode: 'MAIN', quantity: 40, version: level.posVersion }],
      priceLists: [
        {
          code: 'RETAIL', name: 'Retail', type: 'RETAIL', channel: 'ALL', priority: 0, active: true, version: retail.version,
          items: [
            { sku: 'TAP-1', uom: 'pc', minQty: 1, netPriceFils: 11_000 },
            { sku: 'CAB-25', uom: 'm', minQty: 1, netPriceFils: 155 },
          ],
        },
      ],
    };
    const summary = await app.get(ReconciliationService).run();
    expect(summary!.stock.fixed).toBe(1);
    expect(summary!.prices.fixed).toBe(1); // CAB-25 1 m price
    expect(summary!.prices.removed).toBe(1); // CAB-25 100 m break no longer in the POS

    const fixed = await prisma.stockLevel.findFirstOrThrow({ where: { variant: { sku: 'TAP-1' } } });
    expect(Number(fixed.quantity)).toBe(40);
    const run = await prisma.syncRun.findFirstOrThrow({ orderBy: { startedAt: 'desc' } });
    expect(run.status).toBe('SUCCEEDED');
  });

  it('creates unknown SKUs as unpublished drafts', async () => {
    await app.get(PosEventHandler).applyProduct({
      sku: 'NEW-1', name: 'New Hinge', baseUom: 'pc', weightGrams: 0, vatClass: 'STANDARD_5',
      active: true, uomConversions: [], version: 1,
    });
    const p = await prisma.product.findFirstOrThrow({ where: { variants: { some: { sku: 'NEW-1' } } } });
    expect(p.published).toBe(false);
  });
});

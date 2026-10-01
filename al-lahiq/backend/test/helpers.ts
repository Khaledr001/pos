import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { sign, verifySignature } from '../src/modules/pos-sync/pos-signature.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: ['error'] });
  setupApp(app);
  await app.init();
  return app;
}

/** Empties every table between test files. */
export async function resetDb(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

let eventSeq = 0;

/** Sends a correctly signed POS webhook. */
export function posEvent(app: INestApplication, type: string, data: unknown, eventId = `evt-${Date.now()}-${++eventSeq}`) {
  const body = JSON.stringify({ eventId, type, data });
  const ts = Math.floor(Date.now() / 1000);
  return request(app.getHttpServer())
    .post('/api/v1/pos/webhooks')
    .set('content-type', 'application/json')
    .set('x-al-timestamp', String(ts))
    .set('x-al-signature', sign(process.env.POS_WEBHOOK_SECRET!, ts, body))
    .send(body);
}

/** Minimal catalog pushed the way the POS would. */
export async function seedCatalog(app: INestApplication) {
  const prisma = app.get(PrismaService);
  await prisma.branch.create({ data: { code: 'MAIN', name: 'Main', emirate: 'DUBAI', address: 'Al Quoz' } });
  await prisma.shippingRate.create({
    data: { emirate: 'DUBAI', baseFils: 2000, baseWeightKg: 5, perKgFils: 200, freeOverFils: 50_000, maxWeightKg: 30, etaDays: 1 },
  });

  const products = [
    { sku: 'TAP-1', name: 'Basin Tap', baseUom: 'pc', weightGrams: 500 },
    { sku: 'CAB-25', name: 'Cable 2.5mm', baseUom: 'm', weightGrams: 30, uomConversions: [{ uom: 'roll', factor: 100 }] },
  ];
  for (const p of products) {
    await posEvent(app, 'product.upsert', { ...p, active: true, version: 1 }).expect(202);
  }
  await posEvent(app, 'price_list.upserted', { code: 'RETAIL', name: 'Retail', type: 'RETAIL', version: 1 }).expect(202);
  await posEvent(app, 'price_list.upserted', { code: 'TRADE-A', name: 'Trade', type: 'TRADE', version: 1 }).expect(202);
  await posEvent(app, 'price_items.changed', {
    priceListCode: 'RETAIL',
    version: 2,
    upsert: [
      { sku: 'TAP-1', uom: 'pc', minQty: 1, netPriceFils: 10_000 },
      { sku: 'CAB-25', uom: 'm', minQty: 1, netPriceFils: 150 },
      { sku: 'CAB-25', uom: 'm', minQty: 100, netPriceFils: 130 },
    ],
  }).expect(202);
  await posEvent(app, 'stock.updated', {
    items: [
      { sku: 'TAP-1', branchCode: 'MAIN', quantity: 12, version: 1 },
      { sku: 'CAB-25', branchCode: 'MAIN', quantity: 1000, version: 1 },
    ],
  }).expect(202);

  // Website-owned content: publish the products the POS created as drafts.
  await prisma.product.updateMany({ data: { published: true } });
  return prisma;
}

export interface MockPos {
  url: string;
  events: { type: string; eventId: string; data: any; signatureValid: boolean }[];
  snapshot: unknown;
  failNext: number;
  close(): Promise<void>;
}

/** A stand-in for the owner's POS: records events, serves a snapshot. */
export async function startMockPos(): Promise<MockPos> {
  const state: MockPos = { url: '', events: [], snapshot: { products: [], stock: [], priceLists: [] }, failNext: 0, close: async () => {} };
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.method === 'POST' && req.url === '/website/events') {
      if (state.failNext > 0) {
        state.failNext--;
        res.writeHead(503).end('busy');
        return;
      }
      const json = JSON.parse(body.toString());
      state.events.push({
        type: json.type,
        eventId: json.eventId,
        data: json.data,
        signatureValid: verifySignature(
          process.env.POS_OUTBOUND_SECRET!,
          req.headers['x-al-timestamp'] as string,
          req.headers['x-al-signature'] as string,
          body,
          300,
        ),
      });
      res.writeHead(200).end('{}');
      return;
    }
    if (req.method === 'GET' && req.url === '/website/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state.snapshot));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}

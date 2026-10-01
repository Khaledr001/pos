import { backoffMs } from './outbox.service.js';
import { productUpsertSchema, stockUpdatedSchema } from './pos-events.js';
import { sign, verifySignature } from './pos-signature.js';

describe('POS signatures', () => {
  const secret = 'test-secret-1234567890';
  const body = Buffer.from('{"eventId":"e1"}');
  const now = 1_790_000_000_000;
  const ts = Math.floor(now / 1000);

  it('accepts a correct signature', () => {
    expect(verifySignature(secret, String(ts), sign(secret, ts, body), body, 300, now)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = sign(secret, ts, body);
    expect(verifySignature(secret, String(ts), sig, Buffer.from('{"eventId":"e2"}'), 300, now)).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifySignature(secret, String(ts), sign('other-secret', ts, body), body, 300, now)).toBe(false);
  });

  it('rejects old timestamps (replay protection)', () => {
    const old = ts - 301;
    expect(verifySignature(secret, String(old), sign(secret, old, body), body, 300, now)).toBe(false);
  });

  it('rejects missing headers', () => {
    expect(verifySignature(secret, undefined, undefined, body, 300, now)).toBe(false);
  });
});

describe('POS event payloads', () => {
  it('normalises a single stock row into items', () => {
    const parsed = stockUpdatedSchema.parse({ sku: 'A', branchCode: 'MAIN', quantity: 5, version: 2 });
    expect(parsed.items).toHaveLength(1);
  });

  it('applies defaults to product upserts', () => {
    const p = productUpsertSchema.parse({ sku: 'A', name: 'Tap', baseUom: 'pc', active: true, version: 1 });
    expect(p.vatClass).toBe('STANDARD_5');
    expect(p.uomConversions).toEqual([]);
  });

  it('rejects negative versions', () => {
    expect(() =>
      productUpsertSchema.parse({ sku: 'A', name: 'Tap', baseUom: 'pc', active: true, version: -1 }),
    ).toThrow();
  });
});

describe('outbox backoff', () => {
  it('doubles from 30 s and caps at an hour', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});

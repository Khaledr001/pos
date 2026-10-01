import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service.js';
import { PosSnapshot, snapshotSchema } from './pos-events.js';
import { sign, SIGNATURE_HEADER, TIMESTAMP_HEADER } from './pos-signature.js';

export class PosNotConfiguredError extends Error {
  constructor() {
    super('POS_BASE_URL is not configured');
  }
}

/** HTTP client for the owner's POS. Every request is HMAC-signed. */
@Injectable()
export class PosClient {
  constructor(private readonly config: AppConfig) {}

  get configured() {
    return !!this.config.get('POS_BASE_URL');
  }

  private url(path: string) {
    const base = this.config.get('POS_BASE_URL');
    if (!base) throw new PosNotConfiguredError();
    return `${base.replace(/\/$/, '')}${path}`;
  }

  private headers(body: string) {
    const ts = Math.floor(Date.now() / 1000);
    return {
      'content-type': 'application/json',
      [TIMESTAMP_HEADER]: String(ts),
      [SIGNATURE_HEADER]: sign(this.config.get('POS_OUTBOUND_SECRET'), ts, body),
    };
  }

  /** POST {POS_BASE_URL}/website/events — the POS must dedupe on eventId. */
  async sendEvent(event: { eventId: string; type: string; occurredAt: string; data: unknown }) {
    const body = JSON.stringify(event);
    const res = await fetch(this.url('/website/events'), {
      method: 'POST',
      headers: { ...this.headers(body), 'x-al-event-id': event.eventId },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`POS responded ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  /** GET {POS_BASE_URL}/website/snapshot — full products, stock and price lists. */
  async snapshot(): Promise<PosSnapshot> {
    const res = await fetch(this.url('/website/snapshot'), {
      headers: this.headers(''),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`POS snapshot responded ${res.status}`);
    return snapshotSchema.parse(await res.json());
  }
}

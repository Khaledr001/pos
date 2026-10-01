import { Injectable } from '@nestjs/common';

export interface ShipmentRequest {
  orderNumber: string;
  weightGrams: number;
  recipient: { name: string; phone: string; emirate: string; area: string; street: string; building?: string | null };
  codAmountFils?: number;
}

export interface ShipmentResult {
  courier: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl?: string;
}

/**
 * Courier boundary. Real adapters (Aramex, Quiqup, Jeebly...) implement this;
 * the admin panel books shipments through it, so couriers can be swapped.
 */
export interface ShippingProvider {
  readonly name: string;
  createShipment(req: ShipmentRequest, manual?: { trackingNumber: string; trackingUrl?: string }): Promise<ShipmentResult>;
}

/** Staff book the courier themselves and type in the tracking number. */
@Injectable()
export class ManualCourierProvider implements ShippingProvider {
  readonly name = 'manual';

  async createShipment(_req: ShipmentRequest, manual?: { trackingNumber: string; trackingUrl?: string }) {
    if (!manual?.trackingNumber) throw new Error('Tracking number is required for manual shipments');
    return {
      courier: this.name,
      trackingNumber: manual.trackingNumber,
      trackingUrl: manual.trackingUrl,
    };
  }
}

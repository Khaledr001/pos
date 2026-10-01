import { Injectable } from '@nestjs/common';
import { Tx } from '../../prisma/prisma.service.js';

/** Gap-free sequential numbers (orders, invoices), safe under concurrency. */
@Injectable()
export class CountersService {
  async next(tx: Tx, name: string): Promise<number> {
    const rows = await tx.$queryRaw<{ value: number }[]>`
      INSERT INTO counters (name, value) VALUES (${name}, 1)
      ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
      RETURNING value`;
    return Number(rows[0].value);
  }

  async orderNumber(tx: Tx): Promise<string> {
    const n = await this.next(tx, 'order');
    return `AL-${String(n).padStart(6, '0')}`;
  }

  async invoiceNumber(tx: Tx, year = new Date().getFullYear()): Promise<string> {
    const n = await this.next(tx, `invoice:${year}`);
    return `INV-${year}-${String(n).padStart(6, '0')}`;
  }
}

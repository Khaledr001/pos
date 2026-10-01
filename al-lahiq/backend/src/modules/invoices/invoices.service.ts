import { Global, Injectable, Module } from '@nestjs/common';
import pdfmakeModule from 'pdfmake';
import { ApiError } from '../../common/api-error.js';
import { formatAed } from '../../common/money.js';
import { SHIPPING_VAT_BPS } from '../../common/totals.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { CountersService } from '../settings/counters.service.js';
import { SettingsService } from '../settings/settings.service.js';

interface PdfMake {
  setFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (path: string) => boolean): void;
  createPdf(doc: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
}

const pdfmake = pdfmakeModule as unknown as PdfMake;
pdfmake.setFonts({
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
});
// Invoices never load external resources; only the built-in PDF fonts resolve.
const BUILT_IN_FONTS = ['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique'];
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => BUILT_IN_FONTS.includes(path));

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dubai',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

/**
 * UAE tax invoices: seller TRN, invoice number and date, buyer details (TRN for
 * B2B), VAT rate and amount per line, totals in AED. Numbers are sequential per year.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly counters: CountersService,
  ) {}

  /** Issued when the order is placed (paid, or confirmed for COD). Idempotent. */
  async issue(tx: Tx, orderId: string) {
    const existing = await tx.invoice.findUnique({ where: { orderId } });
    if (existing) return existing;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const store = await this.settings.get('store', tx);
    return tx.invoice.create({
      data: {
        orderId,
        invoiceNumber: await this.counters.invoiceNumber(tx),
        sellerTrn: store.trn,
        buyerTrn: order.trn,
        totalNetFils: order.subtotalNetFils - order.discountNetFils + order.shippingNetFils,
        vatFils: order.vatFils,
        totalFils: order.totalFils,
      },
    });
  }

  async pdf(orderId: string): Promise<{ filename: string; buffer: Buffer }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { lines: true, invoice: true, pickupBranch: true },
    });
    if (!order?.invoice) throw ApiError.notFound('Invoice');
    const store = await this.settings.get('store');
    const inv = order.invoice;
    const address = order.shippingAddress as Record<string, string> | null;

    const buyer = [
      order.companyName ?? order.fullName,
      order.companyName ? order.fullName : null,
      address ? [address.building, address.street, address.area, address.emirate].filter(Boolean).join(', ') : null,
      order.phone,
      order.email,
      inv.buyerTrn ? `TRN: ${inv.buyerTrn}` : null,
    ].filter(Boolean) as string[];

    const body: unknown[][] = [
      ['SKU', 'Description', 'Qty', 'Unit price (excl. VAT)', 'VAT %', 'Amount (excl. VAT)'].map((t) => ({
        text: t,
        bold: true,
        fillColor: '#eeeeee',
      })),
      ...order.lines.map((l) => [
        l.sku,
        l.name,
        `${Number(l.quantity)} ${l.uom}`,
        { text: formatAed(l.unitNetFils), alignment: 'right' },
        { text: `${l.vatRateBps / 100}%`, alignment: 'right' },
        { text: formatAed(l.lineNetFils), alignment: 'right' },
      ]),
    ];
    if (order.shippingNetFils > 0) {
      body.push([
        '',
        'Delivery',
        '1',
        { text: formatAed(order.shippingNetFils), alignment: 'right' },
        { text: `${SHIPPING_VAT_BPS / 100}%`, alignment: 'right' },
        { text: formatAed(order.shippingNetFils), alignment: 'right' },
      ]);
    }

    const totals: [string, number, boolean?][] = [
      ['Subtotal (excl. VAT)', order.subtotalNetFils],
      ...(order.discountNetFils ? ([[`Discount${order.couponCode ? ` (${order.couponCode})` : ''}`, -order.discountNetFils]] as [string, number][]) : []),
      ...(order.shippingNetFils ? ([['Delivery (excl. VAT)', order.shippingNetFils]] as [string, number][]) : []),
      ['Taxable amount', inv.totalNetFils],
      ['VAT 5%', inv.vatFils],
      ['Total incl. VAT (AED)', inv.totalFils, true],
    ];

    const doc = {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 50],
      defaultStyle: { font: 'Helvetica', fontSize: 9 },
      content: [
        {
          columns: [
            [
              { text: store.legalName, bold: true, fontSize: 14 },
              { text: store.address },
              { text: `${store.phone} · ${store.email}` },
              { text: `TRN: ${inv.sellerTrn}`, bold: true, margin: [0, 4, 0, 0] },
            ],
            [
              { text: 'TAX INVOICE', bold: true, fontSize: 18, alignment: 'right' },
              { text: `Invoice no: ${inv.invoiceNumber}`, alignment: 'right' },
              { text: `Date: ${dateFmt.format(inv.issuedAt)}`, alignment: 'right' },
              { text: `Order: ${order.orderNumber}`, alignment: 'right' },
              { text: `Payment: ${order.paymentMethod.replace('_', ' ')}`, alignment: 'right' },
            ],
          ],
        },
        { text: 'Bill to', bold: true, margin: [0, 20, 0, 4] },
        ...buyer.map((line) => ({ text: line })),
        order.deliveryMethod === 'PICKUP' && order.pickupBranch
          ? { text: `Store pickup: ${order.pickupBranch.name}`, margin: [0, 4, 0, 0] }
          : { text: '' },
        {
          margin: [0, 16, 0, 0],
          table: { headerRows: 1, widths: [70, '*', 50, 80, 35, 80], body },
          layout: 'lightHorizontalLines',
        },
        {
          margin: [0, 12, 0, 0],
          columns: [
            { width: '*', text: '' },
            {
              width: 230,
              table: {
                widths: ['*', 90],
                body: totals.map(([label, fils, strong]) => [
                  { text: label, bold: !!strong },
                  { text: formatAed(fils), alignment: 'right', bold: !!strong },
                ]),
              },
              layout: 'noBorders',
            },
          ],
        },
        {
          text: 'Prices in AED. VAT charged at 5% under UAE Federal Decree-Law No. 8 of 2017.',
          margin: [0, 30, 0, 0],
          color: '#666666',
          fontSize: 8,
        },
      ],
    };

    const buffer = await pdfmake.createPdf(doc).getBuffer();
    return { filename: `${inv.invoiceNumber}.pdf`, buffer };
  }
}

@Global()
@Module({ providers: [InvoicesService], exports: [InvoicesService] })
export class InvoicesModule {}

/**
 * @devsfleet/pdf-documents
 *
 * The one A4 bilingual tax-document layout, shared by every place that hands
 * a customer a piece of paper: the API (sales invoices, quotations) and the
 * POS terminal (its own A4 invoice, printed straight after payment). A
 * customer who gets a quote from the admin panel and later an invoice off the
 * till should not be looking at two differently-designed documents for the
 * same business.
 */

export * from "./tax-document.js";

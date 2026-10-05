import type { Response } from "express";

/**
 * Writes a PDF straight to the response, for a handler that takes `@Res()`.
 *
 * The global TransformInterceptor wraps every returned value in the JSON
 * ApiSuccess envelope, and a PDF wrapped in JSON is not a PDF. Taking the
 * response object puts the handler in library-specific mode, so Nest leaves
 * the body alone.
 *
 * `attachment` rather than `inline`: the request is "download the bill".
 */
export function sendPdf(res: Response, pdf: { filename: string; body: Buffer }): void {
  res.setHeader("content-type", "application/pdf");
  res.setHeader("content-disposition", `attachment; filename="${pdf.filename}"`);
  res.setHeader("content-length", String(pdf.body.length));
  res.end(pdf.body);
}

import { randomUUID } from "node:crypto";
import type { AspProvider, AspResult, AspSubmission } from "./asp-provider.js";

/**
 * Accepts every document that reaches it and confirms delivery, without leaving
 * the building. It is how a business rehearses the whole flow — queue, build,
 * validate, send, status — before a real provider is connected, and what the
 * test suite and local development use. A document sent here is stamped
 * `mode = sandbox` and is never a report to the tax authority.
 */
export class SandboxProvider implements AspProvider {
  readonly name = "sandbox" as const;

  async submit(submission: AspSubmission): Promise<AspResult> {
    // Deterministic per document: re-submitting the same uuid gives the same reference.
    return { ok: true, providerRef: `sbx-${submission.uuid}`, status: "delivered" };
  }

  async testConnection() {
    return { ok: true, message: `Sandbox provider ready (${randomUUID().slice(0, 8)}). Nothing is sent to a real network.` };
  }
}

import type { FormField } from "@devsfleet/shared-types";
import { isMailbox } from "../notifications/channel-rules.js";
import { shopperPhone } from "../wire.js";

export interface ValidatedAnswers {
  /** In the form's field order, only the fields that were answered. */
  answers: { key: string; label: string; value: string }[];
  /** The value of the field carrying each role. */
  name: string | null;
  email: string | null;
  phone: string | null;
}

export type AnswerErrors = Record<string, string[]>;

const MAX_VALUE = 2000;

/** Control characters out; line breaks kept only where the field is multi-line. */
function clean(raw: string, multiline: boolean): string {
  const unified = raw.replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex
  const stripped = unified.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return (multiline ? stripped : stripped.replace(/\n+/g, " ")).trim();
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * A submission checked against the form that was shown. The browser's own
 * validation is a convenience; this is the rule. Unknown keys are ignored, so a
 * hand-built request cannot smuggle extra data into a lead.
 *
 * Phone numbers go through the shop's region validator (so they are stored in
 * the form the WhatsApp bot matches on); that validator reads the request's
 * region, so this must run inside a storefront request.
 */
export function validateAnswers(
  fields: readonly FormField[],
  values: Record<string, string | number | boolean>,
): { ok: true; value: ValidatedAnswers } | { ok: false; errors: AnswerErrors } {
  const errors: AnswerErrors = {};
  const fail = (key: string, message: string) => {
    (errors[key] ??= []).push(message);
  };
  const answers: ValidatedAnswers["answers"] = [];
  const byRole: Partial<Record<"name" | "email" | "phone", string>> = {};

  for (const field of fields) {
    const raw = values[field.key];

    if (field.type === "checkbox") {
      const checked = raw === true || raw === "true" || raw === "on";
      if (field.required && !checked) fail(field.key, "This needs to be ticked.");
      if (raw !== undefined) answers.push({ key: field.key, label: field.label, value: checked ? "Yes" : "No" });
      continue;
    }

    const text = raw === undefined || typeof raw === "boolean" ? "" : clean(String(raw), field.type === "textarea");
    if (text === "") {
      if (field.required) fail(field.key, "This is required.");
      continue;
    }
    if (text.length > MAX_VALUE) {
      fail(field.key, `Keep this under ${MAX_VALUE} characters.`);
      continue;
    }

    let value = text;
    switch (field.type) {
      case "email":
        if (!isMailbox(text)) fail(field.key, "Enter a valid email address.");
        else value = text.toLowerCase();
        break;
      case "phone": {
        const parsed = shopperPhone.safeParse(text);
        if (!parsed.success) fail(field.key, parsed.error.issues[0]?.message ?? "Enter a valid phone number.");
        else value = parsed.data;
        break;
      }
      case "number":
        if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) fail(field.key, "Enter a number.");
        break;
      case "date":
        if (!validDate(text)) fail(field.key, "Enter a date like 2026-12-31.");
        break;
      case "select":
        if (!(field.options ?? []).includes(text)) fail(field.key, "Choose one of the options.");
        break;
      default:
        break;
    }
    if (errors[field.key]) continue;

    answers.push({ key: field.key, label: field.label, value });
    if (field.role && byRole[field.role] === undefined) byRole[field.role] = value;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { answers, name: byRole.name ?? null, email: byRole.email ?? null, phone: byRole.phone ?? null } };
}

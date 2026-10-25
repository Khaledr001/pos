import { NAV_HREF } from "@devsfleet/shared-types";
import { z } from "zod";

/** Primitive field rules shared by the appearance, section, form and site schemas. */

export const text = (max: number) => z.string().trim().max(max);
export const label = (max: number) => z.string().trim().min(1).max(max);

/** A path on the shop or an https URL. Nothing that could run script. */
export const href = z.string().trim().max(500).regex(NAV_HREF, "Use a path like /pages/about or an https:// link");

/** An image already uploaded to the platform, or any http(s) URL. Used by the theme (favicon, share image). */
export const imageUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https?:\/\/[^\s]+|\/(?![/\\])[^\s]*)$/, "Use an http(s) URL or an uploaded file's path");

/**
 * An image a page section shows: https, an uploaded file's path, or a local
 * development origin. Plain http to anywhere else would be mixed content on an
 * https shop, so it is refused.
 */
export const sectionImage = z
  .string()
  .trim()
  .max(500)
  .regex(/^(https:\/\/[^\s]+|http:\/\/localhost(:\d+)?\/[^\s]*|\/uploads\/[^\s]*)$/, "Use an https:// image URL or an uploaded file");

export const https = z.string().trim().max(300).regex(/^https:\/\/[^\s]+$/, "Use a full https:// link");

export const SLUG_LIKE = /^[a-z0-9][a-z0-9-]{0,254}$/;

/** A mailbox with no display name and no line breaks; the mail layer re-checks. */
export const mailbox = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@<>",;:\\]+@[^\s@<>",;:\\]+\.[^\s@<>",;:\\]+$/, "Enter a plain email address like name@example.com");

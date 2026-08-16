/**
 * @devsfleet/shared-utils
 *
 * Pure, dependency-free helpers usable from Node, the browser and the Electron
 * renderer. Nothing here may import from a framework, touch the filesystem, or
 * read process.env — that keeps it testable with `node --test` and bundleable
 * into the POS renderer without a shim.
 */

export * as Money from "./money.js";
export * from "./totals.js";
export * from "./document-number.js";
export * from "./text.js";
export * from "./result.js";

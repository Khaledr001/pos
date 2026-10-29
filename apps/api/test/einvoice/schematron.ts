/**
 * Runs the OFFICIAL PINT AE Schematron over a generated document.
 *
 * The specification publishes its rules as XSLT 2.0 (resources.zip on
 * docs.peppol.eu/poac/ae/pint-ae). Saxon-JS runs compiled stylesheets, so each
 * is compiled once (xslt3, pure JS — no Java) into a cache directory and reused.
 *
 * Opt-in: set PINT_AE_RESOURCES to the folder where resources.zip was
 * extracted (it must contain trn-invoice/ and trn-creditnote/). Without it the
 * conformance specs skip, so the suite stays hermetic; with it, every generated
 * XML is judged by the same rules the network applies.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);

export const resourcesDir = process.env.PINT_AE_RESOURCES ?? "";
export const schematronAvailable = resourcesDir !== "" && existsSync(join(resourcesDir, "trn-invoice", "schematron"));

type Kind = "trn-invoice" | "trn-creditnote";
const RULESETS = ["PINT-UBL-validation-preprocessed", "PINT-jurisdiction-aligned-rules"] as const;

const cache = join(tmpdir(), "devsfleet-pint-ae-sef");

function compiled(kind: Kind, ruleset: (typeof RULESETS)[number]): string {
  const sef = join(cache, kind, `${ruleset}.sef.json`);
  if (existsSync(sef)) return sef;
  mkdirSync(join(cache, kind), { recursive: true });
  const xslt3 = join(require.resolve("xslt3/package.json"), "..", "xslt3.js");
  execFileSync(process.execPath, [xslt3, `-xsl:${join(resourcesDir, kind, "schematron", `${ruleset}.xslt`)}`, `-export:${sef}`, "-nogo"], { stdio: "ignore" });
  return sef;
}

/** Findings from both rule sets, as "flag rule-id: message". Empty = the document conforms. */
export async function schematronFindings(xml: string, kind: Kind): Promise<string[]> {
  const SaxonJS = require("saxon-js") as { transform: (options: Record<string, unknown>, mode: "async") => Promise<{ principalResult: string }> };
  const findings: string[] = [];
  for (const ruleset of RULESETS) {
    const result = await SaxonJS.transform({ stylesheetFileName: compiled(kind, ruleset), sourceText: xml, destination: "serialized" }, "async");
    const svrl = result.principalResult;
    const pattern = /<svrl:(?:failed-assert|successful-report)[^>]*?id="([^"]*)"[^>]*?flag="([^"]*)"[^>]*?>\s*<svrl:text>([\s\S]*?)<\/svrl:text>/g;
    for (const m of svrl.matchAll(pattern)) findings.push(`${m[2]} ${m[1]}: ${m[3]!.trim().slice(0, 240)}`);
  }
  return findings;
}

/** An official example file from the resources, for checking the harness itself. */
export function officialExample(kind: Kind, name: string): string {
  return readFileSync(join(resourcesDir, kind, "example", name), "utf8");
}

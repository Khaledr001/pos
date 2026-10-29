import { inArray, schema, type Transaction } from "@devsfleet/db";
import { DEFAULT_UNIT_CODE } from "@devsfleet/shared-types";

/**
 * UN/ECE Rec 20 codes for the units a document's lines were sold in, keyed by
 * unit id. Read once per document so a 40-line invoice costs one query, not
 * forty; a unit that no longer exists reads as the generic "each" (C62).
 */
export async function loadUnitCodes(tx: Transaction, unitIds: Iterable<string | null | undefined>): Promise<(unitId: string | null | undefined) => string> {
  const ids = [...new Set([...unitIds].filter((id): id is string => !!id))];
  const rows = ids.length
    ? await tx.select({ id: schema.units.id, unitCode: schema.units.unitCode }).from(schema.units).where(inArray(schema.units.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r.unitCode]));
  return (unitId) => (unitId ? (byId.get(unitId) ?? DEFAULT_UNIT_CODE) : DEFAULT_UNIT_CODE);
}

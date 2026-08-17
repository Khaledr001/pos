import { relations } from "drizzle-orm";
import { index, integer, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { primaryId, quantity, timestamps } from "./_shared.js";
import { users } from "./auth.js";
import { productVariants } from "./catalog.js";
import { sales } from "./sales.js";
import { branches, tenantScope } from "./tenants.js";

/**
 * PAINT — custom colour mixing.
 *
 * A formula names the base can and the tint dosages that turn it into a named
 * colour. Tint components are informational dosages only — the mixing machine
 * meters them from bulk canisters, so they are never tracked as inventory in
 * their own right. What IS tracked, and what a paint order actually deducts, is
 * the base can: `formula.baseVariantId`.
 */
export const paintFormulas = pgTable(
  "paint_formulas",
  {
    id: primaryId(),
    ...tenantScope(),
    /** Manufacturer code, e.g. "RAL 5010". */
    colorCode: varchar({ length: 40 }).notNull(),
    colorName: varchar({ length: 120 }).notNull(),
    /** The base paint container being tinted. What stock actually moves. */
    baseVariantId: uuid()
      .notNull()
      .references(() => productVariants.id, { onDelete: "restrict" }),
    /** Can size in millilitres — 1000 / 4000 / 20000. */
    sizeMl: integer().notNull(),
    notes: text(),
    ...timestamps(),
  },
  (t) => [
    // Unique per size: the same colour code exists at 1L, 4L and 20L, and
    // each size is its own dosage recipe against a different base can.
    uniqueIndex("uq_paint_formulas_code_size").on(t.tenantId, t.colorCode, t.sizeMl),
    index("idx_paint_formulas_search").on(t.tenantId, t.colorName),
  ],
);

export const formulaComponents = pgTable(
  "formula_components",
  {
    id: primaryId(),
    ...tenantScope(),
    formulaId: uuid()
      .notNull()
      .references(() => paintFormulas.id, { onDelete: "cascade" }),
    /** Tint code, e.g. "B1", "KX". Not a catalogue reference — see module note. */
    componentName: varchar({ length: 80 }).notNull(),
    /** Dosage in millilitres. Informational: metered by the mixing machine, not stock. */
    quantityMl: quantity().notNull(),
    sortOrder: integer().notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("idx_formula_components_formula").on(t.formulaId, t.sortOrder)],
);

export const paintOrders = pgTable(
  "paint_orders",
  {
    id: primaryId(),
    ...tenantScope(),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** Null for a fully custom mix that matches no saved formula. */
    formulaId: uuid().references(() => paintFormulas.id, { onDelete: "set null" }),
    /** Link to the sale that paid for it. Null for a mix run before payment is taken. */
    saleId: uuid().references(() => sales.id, { onDelete: "set null" }),
    customNotes: text(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [index("idx_paint_orders_branch").on(t.branchId, t.createdAt)],
);

export const paintFormulasRelations = relations(paintFormulas, ({ one, many }) => ({
  baseVariant: one(productVariants, {
    fields: [paintFormulas.baseVariantId],
    references: [productVariants.id],
  }),
  components: many(formulaComponents),
}));

export const formulaComponentsRelations = relations(formulaComponents, ({ one }) => ({
  formula: one(paintFormulas, {
    fields: [formulaComponents.formulaId],
    references: [paintFormulas.id],
  }),
}));

export const paintOrdersRelations = relations(paintOrders, ({ one }) => ({
  formula: one(paintFormulas, {
    fields: [paintOrders.formulaId],
    references: [paintFormulas.id],
  }),
  branch: one(branches, { fields: [paintOrders.branchId], references: [branches.id] }),
  sale: one(sales, { fields: [paintOrders.saleId], references: [sales.id] }),
}));

export type PaintFormula = typeof paintFormulas.$inferSelect;
export type FormulaComponent = typeof formulaComponents.$inferSelect;
export type PaintOrder = typeof paintOrders.$inferSelect;

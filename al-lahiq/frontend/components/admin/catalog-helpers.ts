import type { AdminCategory } from "@al-lahiq/api-client";

export type CategoryTreeRow = { category: AdminCategory; depth: number };

/** Categories in tree order (parents first, then children), with depth for indenting. */
export function categoryTree(categories: AdminCategory[]): CategoryTreeRow[] {
  const byParent = new Map<string | null, AdminCategory[]>();
  const ids = new Set(categories.map((c) => c.id));
  for (const c of categories) {
    // Orphans (parent missing) are shown at the top level rather than hidden.
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  const out: CategoryTreeRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ category: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** <option>s for a category select, indented to show the tree. */
export function categoryOptions(categories: AdminCategory[], exclude?: string) {
  const rows = categoryTree(categories);
  // Leave out the excluded category and everything under it (can't be its own parent).
  const skip = new Set<string>();
  if (exclude) {
    skip.add(exclude);
    for (const r of rows) if (r.category.parentId && skip.has(r.category.parentId)) skip.add(r.category.id);
  }
  return rows
    .filter((r) => !skip.has(r.category.id))
    .map((r) => ({ value: r.category.id, label: `${" ".repeat(r.depth)}${r.category.name}${r.category.active ? "" : " (hidden)"}` }));
}

let counter = 0;
/** Stable React keys for rows edited in local state. */
export function rowKey() {
  counter += 1;
  return `r${counter}`;
}

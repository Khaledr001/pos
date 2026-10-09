import * as React from "react";

/** The text a person would read in an option: what the search box matches against. */
export function nodeText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

interface Predicates {
  isItem: (element: React.ReactElement) => boolean;
  /** A wrapper such as SelectGroup whose own children are options. */
  isGroup: (element: React.ReactElement) => boolean;
}

export function countItems(children: React.ReactNode, { isItem, isGroup }: Predicates): number {
  let count = 0;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
    if (isItem(child)) count += 1;
    else if (isGroup(child) || child.type === React.Fragment) count += countItems(child.props.children, { isItem, isGroup });
  });
  return count;
}

function optionText(element: React.ReactElement<{ children?: React.ReactNode; textValue?: string }>): string {
  return element.props.textValue ?? nodeText(element.props.children);
}

/** Every word typed must appear somewhere in the option, in any order: "pvc 20" finds "20mm PVC pipe". */
export function matchesQuery(text: string, query: string): boolean {
  const haystack = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Keep only the options matching `query`. The option that is currently chosen
 * always stays: Radix reads the trigger's label from the mounted option, so
 * dropping it would blank the trigger while the list is open.
 */
export function filterOptions(
  children: React.ReactNode,
  query: string,
  predicates: Predicates,
  keepValue?: string,
): { nodes: React.ReactNode[]; matches: number } {
  const nodes: React.ReactNode[] = [];
  let matches = 0;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ children?: React.ReactNode; value?: string; textValue?: string }>(child)) {
      nodes.push(child);
      return;
    }
    if (predicates.isItem(child)) {
      const hit = matchesQuery(optionText(child), query);
      if (hit) matches += 1;
      if (hit || (keepValue !== undefined && child.props.value === keepValue)) nodes.push(child);
      return;
    }
    if (predicates.isGroup(child) || child.type === React.Fragment) {
      const inner = filterOptions(child.props.children, query, predicates, keepValue);
      matches += inner.matches;
      // A group whose options were all filtered out would leave a lone heading behind.
      if (countItems(inner.nodes, predicates) > 0) nodes.push(React.cloneElement(child, undefined, ...inner.nodes));
      return;
    }
    nodes.push(child);
  });
  return { nodes, matches };
}

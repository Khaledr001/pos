import * as React from "react";
import { describe, expect, it } from "vitest";
import { countItems, filterOptions, matchesQuery, nodeText } from "./select-search";

const Item = (_: { value: string; children?: React.ReactNode }) => null;
const Group = (_: { children?: React.ReactNode }) => null;
const predicates = {
  isItem: (e: React.ReactElement) => e.type === Item,
  isGroup: (e: React.ReactElement) => e.type === Group,
};
const item = (value: string, label: string) => React.createElement(Item, { value, key: value }, label);

describe("nodeText", () => {
  it("reads strings, numbers and nested elements", () => {
    expect(nodeText(["Box ", 12, React.createElement("b", null, " (pcs)")])).toBe("Box 12 (pcs)");
    expect(nodeText(null)).toBe("");
  });
});

describe("matchesQuery", () => {
  it("needs every word, in any order, ignoring case", () => {
    expect(matchesQuery("20mm PVC pipe", "pvc 20")).toBe(true);
    expect(matchesQuery("20mm PVC pipe", "pvc 25")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("filterOptions", () => {
  const options = [item("a", "Padlocks"), item("b", "Hand Tools"), item("c", "Power Tools")];

  it("keeps matching options and counts them", () => {
    const { nodes, matches } = filterOptions(options, "tools", predicates);
    expect(matches).toBe(2);
    expect(countItems(nodes, predicates)).toBe(2);
  });

  it("keeps the chosen option even when it does not match, without counting it as a match", () => {
    const { nodes, matches } = filterOptions(options, "power", predicates, "a");
    expect(matches).toBe(1);
    expect(countItems(nodes, predicates)).toBe(2);
  });

  it("drops a group left with no options", () => {
    const grouped = [
      React.createElement(Group, { key: "g1" }, item("a", "Padlocks")),
      React.createElement(Group, { key: "g2" }, item("b", "Hand Tools")),
    ];
    const { nodes } = filterOptions(grouped, "tools", predicates);
    expect(nodes).toHaveLength(1);
  });

  it("finds options inside fragments", () => {
    const wrapped = [React.createElement(React.Fragment, { key: "f" }, item("a", "Padlocks"), item("b", "Hand Tools"))];
    expect(countItems(wrapped, predicates)).toBe(2);
    expect(filterOptions(wrapped, "lock", predicates).matches).toBe(1);
  });
});

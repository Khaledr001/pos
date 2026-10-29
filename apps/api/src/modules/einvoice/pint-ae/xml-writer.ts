/**
 * A deliberately small XML writer: elements, attributes and escaped text, and
 * nothing else. Every value that reaches the output goes through `escapeText`
 * or `escapeAttribute`, so a product called `Pipe & "Fitting" <5mm>` or a
 * customer name with a control character cannot break the document or inject
 * markup.
 */
export type XmlChild = string | XmlNode | null | undefined | false;

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlChild[];
  text: string | null;
}

/** Characters XML 1.0 forbids (control codes, lone surrogates, U+FFFE/F). Removed, not escaped: there is no way to write them. */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function escapeText(value: string): string {
  return value.replace(ILLEGAL, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
}

/** An element holding text. */
export function leaf(tag: string, text: string | number, attrs: Record<string, string> = {}): XmlNode {
  return { tag, attrs, children: [], text: String(text) };
}

/** An element holding child elements; null/false children are dropped so optional parts read naturally. */
export function node(tag: string, ...children: XmlChild[]): XmlNode {
  return { tag, attrs: {}, children, text: null };
}

export function withAttrs(n: XmlNode, attrs: Record<string, string>): XmlNode {
  return { ...n, attrs: { ...n.attrs, ...attrs } };
}

const TAG = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;

export function serialize(root: XmlNode, rootAttrs: Record<string, string>): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const emit = (n: XmlNode, depth: number, extra: Record<string, string> = {}) => {
    if (!TAG.test(n.tag)) throw new Error(`Invalid XML tag ${JSON.stringify(n.tag)}`);
    const pad = "\t".repeat(depth);
    const attrs = { ...extra, ...n.attrs };
    const attrText = Object.entries(attrs)
      .map(([k, v]) => {
        if (!TAG.test(k)) throw new Error(`Invalid XML attribute ${JSON.stringify(k)}`);
        return ` ${k}="${escapeAttribute(v)}"`;
      })
      .join("");
    const kids = n.children.filter((c): c is string | XmlNode => c !== null && c !== undefined && c !== false);
    if (n.text !== null) {
      lines.push(`${pad}<${n.tag}${attrText}>${escapeText(n.text)}</${n.tag}>`);
    } else if (kids.length === 0) {
      lines.push(`${pad}<${n.tag}${attrText}/>`);
    } else {
      lines.push(`${pad}<${n.tag}${attrText}>`);
      for (const kid of kids) {
        if (typeof kid === "string") lines.push(`${"\t".repeat(depth + 1)}${escapeText(kid)}`);
        else emit(kid, depth + 1);
      }
      lines.push(`${pad}</${n.tag}>`);
    }
  };
  emit(root, 0, rootAttrs);
  return lines.join("\n") + "\n";
}

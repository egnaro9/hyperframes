import { decodeHTMLAttribute } from "entities/decode";

export type HtmlAttributeSpan = {
  name: string;
  start: number;
  end: number;
} & (
  | { kind: "boolean" }
  | { kind: "value"; value: string; valueStart: number; valueEnd: number; quote: string }
);

export interface HtmlOpeningTagSpan {
  name: string;
  start: number;
  end: number;
  bodyEnd: number;
  closed: boolean;
  rawTextEnd: number | null;
  attributes: HtmlAttributeSpan[];
}

function readOpeningTag(html: string, start: number, name: string, at: number): HtmlOpeningTagSpan {
  const attributes: HtmlAttributeSpan[] = [];
  while (at < html.length) {
    while (/[\t\n\f\r /]/.test(html[at] ?? "")) at++;
    if (at >= html.length || html[at] === ">") break;
    const attrStart = at;
    while (at < html.length && !/[\t\n\f\r =/>]/.test(html[at]!)) at++;
    if (at === attrStart) {
      at++;
      continue;
    }
    const attrName = html.slice(attrStart, at).toLowerCase();
    const nameEnd = at;
    while (/[\t\n\f\r ]/.test(html[at] ?? "")) at++;
    if (html[at] !== "=") {
      attributes.push({ kind: "boolean", name: attrName, start: attrStart, end: nameEnd });
      continue;
    }
    at++;
    while (/[\t\n\f\r ]/.test(html[at] ?? "")) at++;
    const quote = html[at] === '"' || html[at] === "'" ? html[at]! : "";
    if (quote) at++;
    const valueStart = at;
    if (quote) {
      while (at < html.length && html[at] !== quote) at++;
    } else {
      while (at < html.length && !/[\t\n\f\r >]/.test(html[at]!)) at++;
    }
    const valueEnd = at;
    if (quote && html[at] === quote) at++;
    attributes.push({
      kind: "value",
      name: attrName,
      start: attrStart,
      end: at,
      valueStart,
      valueEnd,
      value: html.slice(valueStart, valueEnd),
      quote,
    });
  }
  const closed = html[at] === ">";
  return {
    name: name.toLowerCase(),
    start,
    bodyEnd: at,
    end: closed ? at + 1 : at,
    closed,
    rawTextEnd: null,
    attributes,
  };
}

export function scanHtmlOpeningTags(html: string): HtmlOpeningTagSpan[] {
  const tags: HtmlOpeningTagSpan[] = [];
  const opening = /<!--[\s\S]*?(?:--!?>|$)|<([a-z][^\t\n\f\r />]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(html)) !== null) {
    if (!match[1]) continue;
    const tag = readOpeningTag(html, match.index, match[1], opening.lastIndex);
    tags.push(tag);
    opening.lastIndex = tag.end;
    if (
      [
        "script",
        "style",
        "textarea",
        "title",
        "xmp",
        "iframe",
        "noembed",
        "noframes",
        "plaintext",
      ].includes(tag.name)
    ) {
      if (tag.name === "plaintext") {
        tag.rawTextEnd = html.length;
        break;
      }
      const closing = new RegExp(`</${tag.name}(?=[\\t\\n\\f\\r />])`, "gi");
      closing.lastIndex = tag.end;
      const end = closing.exec(html);
      tag.rawTextEnd = end?.index ?? html.length;
      opening.lastIndex = tag.rawTextEnd;
    }
  }
  return tags;
}

export const HTML_ATTRIBUTE_ENTITIES: Record<string, readonly string[]> = {
  "&": ["&amp;"],
  '"': ["&quot;"],
  "'": ["&#39;", "&apos;"],
  "<": ["&lt;"],
  ">": ["&gt;"],
};
export function decodeAuthoredAttribute(value: string): string {
  return decodeHTMLAttribute(value);
}

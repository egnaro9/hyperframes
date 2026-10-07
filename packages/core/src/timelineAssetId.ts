export function buildTimelineAssetId(assetPath: string, existingIds: Iterable<string>): string {
  const baseName = assetPath.split("/").pop() ?? "asset";
  const normalized = baseName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  const baseId = normalized || "asset";
  const ids = new Set(existingIds);
  if (!ids.has(baseId)) return baseId;
  let suffix = 2;
  while (ids.has(`${baseId}_${suffix}`)) suffix += 1;
  return `${baseId}_${suffix}`;
}

function documentElements(document: Document): Element[] {
  const elements: Element[] = [];
  const visit = (element: Element): void => {
    elements.push(element);
    for (const child of Array.from(element.children)) visit(child);
    if (element.tagName.toLowerCase() === "template" && element.children.length === 0) {
      const content = (element as HTMLTemplateElement).content;
      if (content) for (const child of Array.from(content.children)) visit(child);
    }
  };
  if (document.documentElement) visit(document.documentElement);
  return elements;
}

function decodeIdEscape(original: string, hex: string): string {
  const codePoint = Number.parseInt(hex, 16);
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : original;
}

function referencesId(value: string, id: string): boolean {
  const decoded = value
    .replace(/\\x([0-9a-f]{2})/gi, (original, hex) => decodeIdEscape(original, hex))
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (original, braced, fixed) =>
      decodeIdEscape(original, braced ?? fixed),
    )
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (original, hex) => decodeIdEscape(original, hex))
    .replace(/\\([^\r\n])/g, "$1");
  return decoded.includes(id);
}

export function replacementTimelineAssetId(
  document: Document,
  element: Element,
  newSrc: string,
): string | null {
  if (!["video", "audio", "img"].includes(element.tagName.toLowerCase())) return null;
  const oldSrc = element.getAttribute("src");
  const id = element.getAttribute("id");
  if (!oldSrc || !id || oldSrc === newSrc) return null;
  if (
    ["data-timeline-label", "data-label", "aria-label"].some((name) =>
      element.getAttribute(name)?.trim(),
    )
  )
    return null;
  const base = buildTimelineAssetId(oldSrc, []);
  const suffix = id.slice(base.length);
  if (id !== base && (!id.startsWith(base) || !/^_[2-9]\d*$|^_1\d+$/.test(suffix))) return null;
  const elements = documentElements(document);
  for (const other of elements) {
    if (
      ["script", "style"].includes(other.tagName.toLowerCase()) &&
      referencesId(other.textContent ?? "", id)
    )
      return null;
    for (const attribute of Array.from(other.attributes)) {
      if (attribute.name === "id" || attribute.name === "data-hf-id") continue;
      if (attribute.name === "src") {
        const fragment = attribute.value.split("#").slice(1).join("#");
        let decodedFragment = fragment;
        try {
          decodedFragment = decodeURIComponent(fragment);
        } catch {
          decodedFragment = fragment;
        }
        if (referencesId(decodedFragment, id)) return null;
        continue;
      }
      if (referencesId(attribute.value, id)) return null;
    }
  }
  const ids = elements
    .filter((other) => other !== element)
    .map((other) => other.getAttribute("id"))
    .filter((value): value is string => value !== null);
  return buildTimelineAssetId(newSrc, ids);
}

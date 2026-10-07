/**
 * Shared primitives for scanning and rewriting asset paths in HTML/CSS.
 *
 * Used by: rewriteSubCompPaths (core), collectExternalAssets (producer),
 * localizeExternalAssets (CLI publish).
 */

import { isAbsolute, relative, resolve } from "node:path";

/**
 * Regex matching CSS `url(...)` references — captures the quote style and the
 * raw URL. The URL group is anchored to non-whitespace at both ends so the
 * surrounding `\s*` can never overlap it (avoids polynomial-ReDoS backtracking);
 * the captured value is whitespace-bounded already, matching the old behavior
 * after callers `.trim()` it.
 */
export const CSS_URL_RE = /\burl\(\s*(["']?)([^)"'\s](?:[^)"']*[^)"'\s])?)\1\s*\)/g;

/** Attributes that may contain relative asset paths. */
export const PATH_ATTRS = ["src", "href"] as const;

/** Returns true for URLs/prefixes that should never be rewritten. */
export function isNonRelativeUrl(val: string): boolean {
  return (
    !val ||
    val.startsWith("http://") ||
    val.startsWith("https://") ||
    val.startsWith("//") ||
    val.startsWith("data:") ||
    val.startsWith("#") ||
    val.startsWith("/")
  );
}

/**
 * Cross-platform containment check: is `childPath` inside `parentPath`?
 * Equality counts as "inside".
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  const absChild = resolve(childPath);
  const absParent = resolve(parentPath);
  if (absChild === absParent) return true;
  const rel = relative(absParent, absChild);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

// A browser sends src="100%.png" as-is, so a % without two hex digits after it is the file's own.
export function decodeWellFormedEscapes(path: string): string {
  return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

export function splitUrlSuffix(urlValue: string): { basePath: string; suffix: string } {
  const queryIdx = urlValue.indexOf("?");
  const hashIdx = urlValue.indexOf("#");
  if (queryIdx < 0 && hashIdx < 0) return { basePath: urlValue, suffix: "" };
  let cutIdx = urlValue.length;
  if (queryIdx >= 0) cutIdx = Math.min(cutIdx, queryIdx);
  if (hashIdx >= 0) cutIdx = Math.min(cutIdx, hashIdx);
  return { basePath: urlValue.slice(0, cutIdx), suffix: urlValue.slice(cutIdx) };
}

export function decodedUrlPath(url: string): string {
  return decodeWellFormedEscapes(splitUrlSuffix(url).basePath);
}

export function encodeUrlPath(path: string): string {
  return encodeURIComponent(path)
    .replace(/%2F/g, "/")
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

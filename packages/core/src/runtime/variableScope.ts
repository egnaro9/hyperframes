/**
 * Resolve the composition-variable values an element should see: the scoped
 * per-instance table for inlined sub-compositions, then the top-level merged
 * getVariables(), then the raw render-injection global. Shared by every
 * runtime consumer of variables (color grading, declarative bindings) so the
 * scope chain can never diverge between channels.
 */

type VariablesWindow = Window & {
  __hfVariables?: Record<string, unknown>;
  __hfVariablesByComp?: Record<string, Record<string, unknown>>;
  __hyperframes?: { getVariables?: () => Record<string, unknown> };
};

const INSTANCE_HOST = "[data-composition-src], [data-composition-file]";

/** The element whose `data-composition-id` keys `element`'s per-instance values: a compiled
 * sub-composition's own root (authored id) defers to its host, which carries the instance id. */
export function variableScopeOf(element: Element): Element | null {
  const scope = element.closest("[data-composition-id]");
  const host = scope?.parentElement;
  if (!scope || scope.matches(INSTANCE_HOST) || !host?.matches(INSTANCE_HOST)) return scope;
  return host.hasAttribute("data-composition-id") ? host : scope;
}

export function readVariablesForElement(element: Element): Record<string, unknown> {
  const win = window as VariablesWindow;
  const scope = variableScopeOf(element);
  const compositionId = scope?.getAttribute("data-composition-id")?.trim() ?? "";
  const scoped = compositionId ? win.__hfVariablesByComp?.[compositionId] : undefined;
  if (scoped) return scoped;
  const fromHelper = win.__hyperframes?.getVariables?.();
  if (fromHelper && typeof fromHelper === "object") {
    return fromHelper;
  }
  return win.__hfVariables ?? {};
}

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

/** The element whose `data-composition-id` keys `element`'s per-instance values: a mounted
 * sub-composition root with no values of its own defers to its direct parent, the host. */
export function variableScopeOf(element: Element): Element | null {
  const scope = element.closest("[data-composition-id]");
  const byComp = (window as VariablesWindow).__hfVariablesByComp;
  if (!scope || !byComp || hasScopedValues(byComp, scope)) return scope;
  return scope.parentElement ?? scope;
}

function hasScopedValues(byComp: Record<string, unknown>, el: Element): boolean {
  const id = el.getAttribute("data-composition-id")?.trim();
  return !!id && Object.hasOwn(byComp, id);
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

// @vitest-environment happy-dom

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import { sceneSwapFor } from "../player/sceneSwap";
import { makeSelection } from "./domSelectionTestHarness";
import type { DomEditSelection } from "../components/editor/domEditing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useDomEditPreviewSync", () => {
  it("re-syncs the preview when edited scenes are swapped in, and not when the swap is refused", async () => {
    const iframe = document.createElement("iframe");
    let refuse = false;
    Object.defineProperty(iframe, "contentWindow", {
      value: {
        __hfSwapScenes: async () => {
          if (refuse) throw new Error("the film changed outside its scenes");
        },
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(""));
    const applyManualEdits = vi.fn(async () => {});
    const refreshVersion = vi.fn();
    function Harness() {
      useDomEditPreviewSync({
        previewIframe: iframe,
        activeCompPath: null,
        captionEditMode: false,
        domEditSelectionRef: { current: null },
        domEditGroupSelectionsRef: { current: [] },
        domEditSelection: null,
        refreshDomEditGroupSelectionsFromPreview: async () => {},
        applyDomSelection: () => {},
        buildDomSelectionFromTarget: async () => null,
        refreshPreviewDocumentVersion: refreshVersion,
        syncPreviewHotkeys: () => {},
        applyStudioManualEditsToPreviewRef: { current: applyManualEdits },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
    applyManualEdits.mockClear();
    refreshVersion.mockClear();

    refuse = true;
    await act(() => sceneSwapFor(iframe)!("/preview", () => true).catch(() => {}));
    expect(refreshVersion).not.toHaveBeenCalled();

    refuse = false;
    await act(() => sceneSwapFor(iframe)!("/preview", () => true));
    expect(applyManualEdits).toHaveBeenCalledWith(iframe);
    expect(refreshVersion).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    fetchSpy.mockRestore();
  });

  // The sync re-resolves the selection after a preview load; a deselect landing meanwhile wins.
  it.each([
    ["keeps a deselect made while it resolves the element", true],
    ["re-applies the selection when nothing changed meanwhile", false],
  ])("%s", async (_name, deselect) => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const element = iframe.contentDocument!.createElement("div");
    element.id = "a";
    iframe.contentDocument!.body.append(element);
    const selectionRef = { current: makeSelection("A", element) as DomEditSelection | null };
    let resolveBuild: (selection: DomEditSelection) => void = () => {};
    const buildDomSelectionFromTarget = vi.fn(
      () => new Promise<DomEditSelection | null>((resolve) => (resolveBuild = resolve)),
    );
    const applyDomSelection = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(""));
    function Harness() {
      useDomEditPreviewSync({
        previewIframe: iframe,
        activeCompPath: null,
        captionEditMode: false,
        domEditSelectionRef: selectionRef,
        domEditGroupSelectionsRef: { current: [] },
        domEditSelection: selectionRef.current,
        refreshDomEditGroupSelectionsFromPreview: async () => {},
        applyDomSelection,
        buildDomSelectionFromTarget,
        refreshPreviewDocumentVersion: () => {},
        syncPreviewHotkeys: () => {},
        applyStudioManualEditsToPreviewRef: { current: async () => {} },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
    expect(buildDomSelectionFromTarget).toHaveBeenCalled();
    if (deselect) selectionRef.current = null;
    await act(async () => resolveBuild(makeSelection("A", element)));
    expect(applyDomSelection).toHaveBeenCalledTimes(deselect ? 0 : 1);
    act(() => root.unmount());
    iframe.remove();
    fetchSpy.mockRestore();
  });
});

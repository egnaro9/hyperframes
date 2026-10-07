// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { liveMarkupWithoutPreviewMarks } from "./authoredSource";

describe("liveMarkupWithoutPreviewMarks", () => {
  it("copies authored content without runtime variable ownership marks", () => {
    const live = document.createElement("div");
    live.innerHTML =
      '<section data-hf-variable-host data-composition-id="inner"><p>Hello</p></section>';
    live.setAttribute("data-hf-variable-host", "");
    expect(liveMarkupWithoutPreviewMarks(live)).toBe(
      '<div><section data-composition-id="inner"><p>Hello</p></section></div>',
    );
    expect(live.hasAttribute("data-hf-variable-host")).toBe(true);
  });
});

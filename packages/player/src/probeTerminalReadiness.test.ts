import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HyperframesPlayer } from "./hyperframes-player.js";

function mountPlayer() {
  const player = document.createElement("hyperframes-player") as HyperframesPlayer;
  document.body.appendChild(player);
  const iframe = player.shadowRoot!.querySelector("iframe")!;
  iframe.contentDocument!.body.innerHTML =
    '<div data-composition-id="main"><div data-composition-src="child.html"></div></div>';
  const onError = vi.fn();
  const onReady = vi.fn();
  player.addEventListener("error", onError);
  player.addEventListener("ready", onReady);
  iframe.dispatchEvent(new Event("load"));
  return { player, iframe, onError, onReady };
}

function sendTimeline(iframe: HTMLIFrameElement) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      data: { source: "hf-preview", type: "timeline", durationInFrames: 270, scenes: [] },
    }),
  );
}

describe("terminal probe readiness", () => {
  beforeEach(async () => {
    await import("./hyperframes-player.js");
    vi.useFakeTimers();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not accept a runtime timeline message after the probe timed out", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    vi.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    sendTimeline(iframe);
    expect(onReady).not.toHaveBeenCalled();
    expect(player.ready).toBe(false);
    expect(player.duration).toBe(0);
  });

  it("rejects the failed document while its replacement is still navigating", () => {
    const { player, iframe, onReady } = mountPlayer();
    vi.advanceTimersByTime(8000);
    const failedDocument = iframe.contentDocument;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => failedDocument,
    });
    player.setAttribute("src", "next.html");
    sendTimeline(iframe);
    expect(onReady).not.toHaveBeenCalled();
    expect(player.ready).toBe(false);
    expect(player.duration).toBe(0);
  });

  it("accepts the replacement document handshake before its load event", () => {
    const { player, iframe, onReady } = mountPlayer();
    vi.advanceTimersByTime(8000);
    const failedDocument = iframe.contentDocument;
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => failedDocument,
    });
    player.setAttribute("src", "next.html");
    const replacement = document.implementation.createHTMLDocument("Replacement");
    Object.defineProperty(iframe, "contentDocument", {
      configurable: true,
      get: () => replacement,
    });
    sendTimeline(iframe);
    expect(onReady).toHaveBeenCalledOnce();
    expect(player.ready).toBe(true);
    expect(player.duration).toBe(9);
  });

  it("keeps an opaque document failure latched until its next load event", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    Object.defineProperty(iframe, "contentDocument", { configurable: true, get: () => null });
    vi.advanceTimersByTime(8000);
    expect(onError).toHaveBeenCalledOnce();
    player.setAttribute("src", "https://example.org/next.html");
    sendTimeline(iframe);
    expect(onReady).not.toHaveBeenCalled();
    expect(player.ready).toBe(false);
    iframe.dispatchEvent(new Event("load"));
    sendTimeline(iframe);
    expect(onReady).toHaveBeenCalledOnce();
    expect(player.ready).toBe(true);
    expect(player.duration).toBe(9);
  });

  it("does not accept a runtime handshake after reporting an author error", () => {
    const { player, iframe, onError, onReady } = mountPlayer();
    Object.assign(iframe.contentWindow!, { __hfPreviewErrors: ["Uncaught Error: author failed"] });
    vi.advanceTimersByTime(200);
    expect(onError.mock.calls[0][0].detail.message).toBe("Uncaught Error: author failed");
    sendTimeline(iframe);
    expect(onReady).not.toHaveBeenCalled();
    expect(player.ready).toBe(false);
    expect(player.duration).toBe(0);
  });
});

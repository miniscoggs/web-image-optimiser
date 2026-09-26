import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineFileResult } from "../../src/pipeline/types.js";
import { canCompare } from "../../ui/src/comparison.js";
import ComparisonViewer from "../../ui/src/components/ComparisonViewer.js";
import { imageUrl } from "../../ui/src/refs.js";
import { jsonResponse, stubFetch } from "./fetchStub.js";
import { sameResult, suiteResult } from "./results.js";

const DIFF_REF = "session/diffs/1/diff.png";

/**
 * Opens the viewer on a file.
 *
 * @param file - The file's result.
 * @returns What closing it calls.
 */
function openViewer(file: PipelineFileResult) {
  const onClose = vi.fn();

  if (!canCompare(file)) {
    throw new Error("the result should be comparable");
  }
  render(<ComparisonViewer file={file} onClose={onClose} />);
  return onClose;
}

/**
 * Returns the pane showing an image.
 *
 * @param name - The pane's title.
 */
function pane(name: string) {
  return screen.getByRole("region", { name });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ComparisonViewer", () => {
  it("shows the original and every output, with their facts, zoomed together", () => {
    const file = suiteResult();

    openViewer(file);

    expect(
      screen
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label"))
    ).toEqual(["Original", "WebP", "AVIF", "PNG fallback"]);
    expect(
      within(pane("WebP"))
        .getByRole("img", { name: "WebP" })
        .getAttribute("src")
    ).toBe(imageUrl("session/runs/1/0/cat.webp"));
    expect(within(pane("Original")).getByText("64 x 48")).toBeDefined();
    for (const fact of ["q71", "12.4 kB", "87.6% smaller", "score 83.2"]) {
      expect(within(pane("WebP")).getByText(fact)).toBeDefined();
    }

    const twice = screen.getByRole("button", { name: "200%" });

    fireEvent.click(twice);

    const images = screen.getAllByRole("img");

    expect(twice.getAttribute("aria-pressed")).toBe("true");
    expect(images).toHaveLength(4);
    expect(new Set(images.map((image) => image.style.width))).toEqual(
      new Set([`${64 * 2}px`])
    );
    for (const name of ["Original", "WebP", "AVIF", "PNG fallback"]) {
      const viewport = within(pane(name)).getByRole("group", { name });

      expect(viewport.dataset.pixelated).toBe("true");
    }
  });

  it("shows a same-mode file side by side with its output", () => {
    openViewer(sameResult());

    expect(
      screen
        .getAllByRole("region")
        .map((region) => region.getAttribute("aria-label"))
    ).toEqual(["Original", "JPEG"]);
  });

  it("wipes an output against the original, from its button or a click on it", () => {
    openViewer(suiteResult());

    fireEvent.click(within(pane("WebP")).getByRole("button", { name: "Wipe" }));

    const wipe = pane("Original against the WebP");
    const divider = within(wipe).getByRole("slider", { name: "Wipe position" });

    expect(divider.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(divider.getAttribute("aria-valuenow")).toBe("45");

    const clip = within(wipe).getByRole("img", { name: "Original" })
      .parentElement?.style.clipPath;
    const hidden = /^inset\(0 ([\d.]+)% 0 0\)$/.exec(clip ?? "")?.[1]; // the original is cut off right of the divider

    expect(Number(hidden)).toBeCloseTo(55);

    fireEvent.click(screen.getByRole("button", { name: "Back to grid" }));

    const avif = within(pane("AVIF")).getByRole("group", { name: "AVIF" });

    fireEvent.pointerDown(avif, { pointerId: 1, button: 0, clientX: 5 });
    fireEvent.pointerUp(avif, { pointerId: 1, button: 0, clientX: 6 });
    expect(pane("Original against the AVIF")).toBeDefined();
  });

  it("overlays an output's diff map at the opacity chosen", async () => {
    const fetchMock = stubFetch({
      "/api/diff": () => jsonResponse({ ref: DIFF_REF }),
    });

    openViewer(suiteResult());

    const webp = pane("WebP");

    fireEvent.click(within(webp).getByRole("checkbox", { name: "Diff" }));

    const overlay = await within(webp).findByRole("img", {
      name: "Where the WebP differs from the original",
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/diff",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          original: "root/photos/cat.png",
          candidate: "session/runs/1/0/cat.webp",
        }),
      })
    );
    expect(overlay.getAttribute("src")).toBe(imageUrl(DIFF_REF));

    fireEvent.change(
      within(webp).getByRole("slider", { name: "WebP diff opacity" }),
      { target: { value: "40" } }
    );
    expect(overlay.parentElement?.style.opacity).toBe("0.4");

    fireEvent.click(within(webp).getByRole("checkbox", { name: "Diff" }));
    expect(within(webp).queryByRole("img", { name: /differs/ })).toBeNull();
    fireEvent.click(within(webp).getByRole("checkbox", { name: "Diff" }));
    expect(within(webp).getByRole("img", { name: /differs/ })).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-encodes a lossy output at the quality chosen once the slider rests", async () => {
    const fetchMock = stubFetch({
      "/api/encode": (body) => {
        const { quality } = body as { quality: number };

        return jsonResponse({
          ref: `session/encodes/1/cat-${quality}.webp`,
          format: "webp",
          quality,
          bytes: 8_000,
          saving: 0.92,
          score: 78.5,
          verdict: "high",
          warnings: [],
        });
      },
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    openViewer(suiteResult());

    const webp = pane("WebP");
    const slider = within(webp).getByRole("slider", { name: "WebP quality" });

    expect((slider as HTMLInputElement).value).toBe("71");
    expect(
      within(pane("PNG fallback")).queryByRole("slider", { name: /quality/ })
    ).toBeNull();

    fireEvent.change(slider, { target: { value: "60" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(slider, { target: { value: "55" } });
    act(() => {
      vi.advanceTimersByTime(149);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/encode",
      expect.objectContaining({
        body: JSON.stringify({
          file: "root/photos/cat.png",
          format: "webp",
          quality: 55,
        }),
      })
    );
    vi.useRealTimers();

    expect(await within(webp).findByText("q55")).toBeDefined();
    for (const fact of ["8.00 kB", "92.0% smaller", "score 78.5", "high"]) {
      expect(within(webp).getByText(fact)).toBeDefined();
    }
    expect(
      within(webp).getByRole("img", { name: "WebP" }).getAttribute("src")
    ).toBe(imageUrl("session/encodes/1/cat-55.webp"));

    fireEvent.click(within(webp).getByRole("button", { name: "Reset" }));
    expect(within(webp).getByText("q71")).toBeDefined();
    expect((slider as HTMLInputElement).value).toBe("71");
  });

  it("writes the output shown, replacing the original only when asked, then drops the stale tools", async () => {
    const fetchMock = stubFetch({
      "/api/write": (body) =>
        jsonResponse({
          ref: "root/photo.jpg",
          outcome: (body as { inPlace?: boolean }).inPlace
            ? "written"
            : "input",
        }),
    });

    openViewer(sameResult());

    const jpeg = pane("JPEG");

    fireEvent.click(within(jpeg).getByRole("button", { name: "Write" }));
    expect(
      await within(jpeg).findByText("This replaces the original")
    ).toBeDefined();

    fireEvent.click(
      within(jpeg).getByRole("button", { name: "Replace original" })
    );
    expect(
      await screen.findByText(/The original has been replaced/)
    ).toBeDefined();
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({
        original: "root/photo.jpg",
        candidate: "session/runs/1/0/photo.jpg",
      }),
      JSON.stringify({
        original: "root/photo.jpg",
        candidate: "session/runs/1/0/photo.jpg",
        inPlace: true,
      }),
    ]);
    expect(
      within(jpeg).queryByRole("button", { name: /Write|Replace/ })
    ).toBeNull();
    expect(within(jpeg).queryByRole("slider", { name: /quality/ })).toBeNull();
    expect(within(jpeg).queryByRole("checkbox", { name: "Diff" })).toBeNull();
  });

  it("closes from its Close button", () => {
    const onClose = openViewer(suiteResult());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

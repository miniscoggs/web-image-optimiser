import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineFileResult } from "../../src/pipeline/types.js";
import type { DesktopBridge } from "../../ui/src/desktop.d.ts";
import { canCompare } from "../../ui/src/comparison.js";
import ComparisonViewer from "../../ui/src/components/ComparisonViewer.js";
import { imageUrl } from "../../ui/src/refs.js";
import { jsonResponse, stubFetch } from "./fetchStub.js";
import { sameResult, suiteResult } from "./results.js";
import { ViewerHarness, webpSearch } from "./viewerHarness.js";
import { stubWio } from "./wioStub.js";

const DIFF_REF = "session/diffs/1/diff.png";

/**
 * Opens the viewer on a file.
 *
 * @param file - The file's result.
 */
function openViewer(file: PipelineFileResult) {
  if (!canCompare(file)) {
    throw new Error("the result should be comparable");
  }
  render(<ComparisonViewer file={file} name="cat.png" />);
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
    ).toEqual(["Original", "AVIF", "WebP", "PNG fallback"]);
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

  it("leaves a wipe on Escape", () => {
    openViewer(suiteResult());
    fireEvent.click(within(pane("WebP")).getByRole("button", { name: "Wipe" }));
    expect(pane("Original against the WebP")).toBeDefined();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: /against/ })).toBeNull();
    expect(pane("WebP")).toBeDefined();
  });

  it("says an output larger than the original can't be saved", () => {
    const file = suiteResult();

    openViewer({
      ...file,
      outputs: file.outputs.map((output) => ({ ...output, saving: -0.1 })),
    });
    expect(
      within(pane("WebP")).getByText("Larger than the original")
    ).toBeDefined();
  });

  it("passes the width outputs were capped at to the diff", async () => {
    const fetchMock = stubFetch({
      "/api/diff": () => jsonResponse({ ref: DIFF_REF }),
    });
    const file = suiteResult();

    if (!canCompare(file)) {
      throw new Error("the result should be comparable");
    }
    render(<ComparisonViewer file={file} name="cat.png" maxWidth={32} />);
    fireEvent.click(
      within(pane("WebP")).getByRole("checkbox", { name: "Diff" })
    );
    await within(pane("WebP")).findByRole("img", { name: /differs/ });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({
        original: "root/photos/cat.png",
        candidate: "session/runs/1/0/cat.webp",
        maxWidth: 32,
      })
    );
  });
});

describe("ComparisonViewer tools", () => {
  const ORIGINAL = "root/photos/cat.png";

  /**
   * Opens the viewer with the app's tools.
   */
  function openTooled() {
    const file = suiteResult();

    if (!canCompare(file)) {
      throw new Error("the result should be comparable");
    }
    render(<ViewerHarness file={file} />);
  }

  /**
   * Moves a pane's slider.
   *
   * @param name - The pane's title.
   * @param target - The target to move to.
   */
  function moveSlider(name: string, target: number) {
    fireEvent.change(
      within(pane(name)).getByRole("slider", { name: `${name} target score` }),
      { target: { value: String(target) } }
    );
  }

  it("marks the presets on each raster pane's slider, from 50 to 100, at the run's target", () => {
    stubWio();
    openTooled();

    const slider = within(pane("WebP")).getByRole("slider", {
      name: "WebP target score",
    });

    expect(slider).toMatchObject({ min: "50", max: "100", value: "70" });

    const listId = slider.getAttribute("list") ?? "";
    const options = [
      ...(document.getElementById(listId)?.querySelectorAll("option") ?? []),
    ];

    expect(
      options.map((option) => [option.value, option.getAttribute("label")])
    ).toEqual([
      ["70", "web"],
      ["80", "high"],
      ["85", "excellent"],
      ["90", "visually-lossless"],
    ]);
    expect(
      [...pane("WebP").querySelectorAll(".target-marks span")].map(
        (mark) => mark.textContent
      )
    ).toEqual(["70", "80", "85", "90"]);
  });

  it("searches once the slider has rested, then shows the result and resets", async () => {
    vi.useFakeTimers();
    stubWio();

    const fetchMock = stubFetch({
      "/api/search": () => jsonResponse(webpSearch()),
    });

    openTooled();
    moveSlider("WebP", 78);
    moveSlider("WebP", 80);
    await act(() => vi.advanceTimersByTimeAsync(149));
    expect(fetchMock).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/api/search",
      expect.objectContaining({
        body: JSON.stringify({ file: ORIGINAL, format: "webp", target: 80 }),
      })
    );
    expect(within(pane("WebP")).getByText("20.0 kB")).toBeDefined();
    expect(within(pane("WebP")).getByText("q85")).toBeDefined();

    fireEvent.click(
      within(pane("WebP")).getByRole("button", { name: "Reset" })
    );
    expect(within(pane("WebP")).getByText("12.4 kB")).toBeDefined();
    expect(
      within(pane("WebP")).getByRole<HTMLInputElement>("slider", {
        name: "WebP target score",
      }).value
    ).toBe("70");
  });

  it("asks for the latest target once a search in flight returns", async () => {
    vi.useFakeTimers();
    stubWio();

    const first = Promise.withResolvers<Response>();
    const fetchMock = vi.fn<typeof fetch>(() => first.promise);

    vi.stubGlobal("fetch", fetchMock);
    openTooled();
    moveSlider("WebP", 80);
    await act(() => vi.advanceTimersByTimeAsync(150));
    moveSlider("WebP", 90);
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(fetchMock).toHaveBeenCalledTimes(1); // one per pane in flight

    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse(webpSearch({ bytes: 30_000 })))
    );
    first.resolve(jsonResponse(webpSearch()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)
    ).toMatchObject({ target: 90 });
  });

  it("says when a search fell short, and marks a pane the chain now drops", async () => {
    vi.useFakeTimers();
    stubWio();
    stubFetch({
      "/api/search": () =>
        jsonResponse(webpSearch({ bytes: 70_000, reached: false })),
    });
    openTooled();
    moveSlider("WebP", 95);
    await act(() => vi.advanceTimersByTimeAsync(150));

    const webp = within(pane("WebP"));

    expect(webp.getByText("Target not reached")).toBeDefined();
    expect(
      webp.getByText("Not in the suite: no smaller than the PNG fallback")
    ).toBeDefined();
    expect(pane("AVIF").textContent).not.toContain("Not in the suite");
  });

  it("saves a pane through the bridge with refs only, and says where it went", async () => {
    const { bridge } = stubWio({
      saveOutput: vi.fn(() =>
        Promise.resolve({
          outcome: "saved" as const,
          name: "cat (1).webp",
          written: true,
          replacedOriginal: false,
        })
      ),
    });

    openTooled();
    fireEvent.click(within(pane("WebP")).getByRole("button", { name: "Save" }));
    expect(bridge.saveOutput).toHaveBeenCalledExactlyOnceWith({
      original: ORIGINAL,
      candidate: "session/runs/1/0/cat.webp",
    });
    expect(
      await within(pane("WebP")).findByText("Saved as cat (1).webp")
    ).toBeDefined();
  });

  it("shows why a save failed, and nothing when its dialog is dismissed", async () => {
    const saveOutput = vi
      .fn<DesktopBridge["saveOutput"]>()
      .mockResolvedValueOnce({ outcome: "canceled" })
      .mockResolvedValueOnce({ outcome: "failed", error: "Disk full" });

    stubWio({ saveOutput });
    openTooled();

    const save = () => {
      fireEvent.click(
        within(pane("AVIF")).getByRole("button", { name: "Save" })
      );
    };

    save();
    await waitFor(() => {
      expect(saveOutput).toHaveBeenCalledTimes(1);
    });
    expect(within(pane("AVIF")).queryByRole("alert")).toBeNull();
    save();
    expect((await within(pane("AVIF")).findByRole("alert")).textContent).toBe(
      "Disk full"
    );
  });

  it("has no Save on an output larger than the original", () => {
    stubWio();

    const file = suiteResult();

    if (!canCompare(file)) {
      throw new Error("the result should be comparable");
    }
    render(
      <ViewerHarness
        file={{
          ...file,
          outputs: file.outputs.map((output) => ({ ...output, saving: -0.1 })),
        }}
      />
    );
    expect(
      within(pane("WebP")).queryByRole("button", { name: "Save" })
    ).toBeNull();
  });

  it("saves the suite's kept outputs into a folder, with refs only", async () => {
    const { bridge } = stubWio({
      saveSuites: vi.fn(() =>
        Promise.resolve({
          outcome: "saved" as const,
          folder: "C:/photos",
          files: [
            {
              original: ORIGINAL,
              candidate: "session/runs/1/0/cat.png",
              name: "cat (1).png",
              wanted: "cat.png",
            },
          ],
        })
      ),
    });

    openTooled();
    fireEvent.click(screen.getByRole("button", { name: "Save suite" }));
    expect(bridge.saveSuites).toHaveBeenCalledExactlyOnceWith([
      {
        original: ORIGINAL,
        candidates: [
          "session/runs/1/0/cat.avif",
          "session/runs/1/0/cat.webp",
          "session/runs/1/0/cat.png",
        ],
      },
    ]);
    await waitFor(() => {
      expect(
        screen.getByRole<HTMLButtonElement>("button", { name: "Save suite" })
          .disabled
      ).toBe(false);
    });
  });

  it("drops the sliders and Save buttons, with a notice, once the original is replaced", async () => {
    stubWio({
      saveOutput: vi.fn(() =>
        Promise.resolve({
          outcome: "saved" as const,
          name: "cat.png",
          written: true,
          replacedOriginal: true,
        })
      ),
    });
    openTooled();
    fireEvent.click(within(pane("WebP")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The original was replaced/)).toBeDefined();
    expect(screen.queryByRole("slider", { name: /target score/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save suite" })).toBeNull();
  });
});

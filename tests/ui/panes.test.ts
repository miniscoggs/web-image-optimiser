import { describe, expect, it } from "vitest";
import { canCompare } from "../../ui/src/comparison.js";
import { keptRefs, paneKey, panesOf, runTarget } from "../../ui/src/panes.js";
import type { TargetSearch } from "../../ui/src/useTargetSearches.js";
import { sameResult, suiteResult } from "./results.js";
import { webpSearch } from "./viewerHarness.js";

/**
 * Returns the panes of a suite result, with a search on the roles given.
 *
 * @param searches - Each role's slider.
 * @param without - A role to take out of the run, as the chain rule would.
 */
function panesFor(
  searches: Record<string, TargetSearch> = {},
  without?: string
) {
  const file = suiteResult();

  if (!canCompare(file)) {
    throw new Error("the result should be comparable");
  }
  return panesOf(
    { ...file, outputs: file.outputs.filter(({ role }) => role !== without) },
    (role) => searches[role]
  );
}

/**
 * Returns a slider that has found a WebP of a size.
 *
 * @param bytes - The WebP's size.
 */
function foundWebp(bytes: number): TargetSearch {
  return {
    target: 80,
    pending: false,
    found: {
      target: 80,
      response: webpSearch({ bytes, saving: 1 - bytes / 100_000 }),
    },
  };
}

describe("panesOf", () => {
  it("gives a suite an AVIF, a WebP and a fallback pane, all kept", () => {
    const panes = panesFor();

    expect(panes.map(({ title, kept }) => [title, kept])).toEqual([
      ["AVIF", true],
      ["WebP", true],
      ["PNG fallback", true],
    ]);
    expect(keptRefs(panes)).toEqual([
      "session/runs/1/0/cat.avif",
      "session/runs/1/0/cat.webp",
      "session/runs/1/0/cat.png",
    ]);
  });

  it("keeps an empty pane for a format the suite left out, and says why", () => {
    const [avif, webp] = panesFor({}, "avif");

    expect(avif).toMatchObject({
      title: "AVIF",
      output: undefined,
      format: "avif",
      kept: false,
      note: "Not in the suite: no smaller than the WebP",
    });
    expect(webp?.kept).toBe(true);
  });

  it("keeps the suite's panes and chain rule when the suite has no fallback", () => {
    const [avif, webp, fallback] = panesFor(
      { webp: foundWebp(8_000) },
      "fallback"
    ); // under the AVIF's 9,000

    expect(fallback).toMatchObject({
      title: "Fallback",
      output: undefined,
      kept: false,
    });
    expect(fallback?.format).toBeUndefined(); // no slider
    expect(webp?.kept).toBe(true);
    expect(avif).toMatchObject({
      kept: false,
      note: "Not in the suite: no smaller than the WebP",
    });
  });

  it("shows a search's result in place of the run's output", () => {
    const [, webp] = panesFor({ webp: foundWebp(20_000) });

    expect(webp?.output).toMatchObject({
      path: "session/searches/1/cat.webp",
      bytes: 20_000,
      quality: 85,
      width: 64,
    });
  });

  it("drops a pane the chain rule leaves out after a change, keeping the ones it doesn't", () => {
    const panes = panesFor({ webp: foundWebp(70_000) }); // over the PNG's 61,000

    expect(panes.map(({ title, kept, note }) => [title, kept, note])).toEqual([
      ["AVIF", true, undefined],
      ["WebP", false, "Not in the suite: no smaller than the PNG fallback"],
      ["PNG fallback", true, undefined],
    ]);
    expect(keptRefs(panes)).toEqual([
      "session/runs/1/0/cat.avif",
      "session/runs/1/0/cat.png",
    ]);
  });

  it("never keeps an output larger than the original, and doesn't blame the chain", () => {
    const [, webp] = panesFor({ webp: foundWebp(120_000) });

    expect(webp?.kept).toBe(false);
    expect(webp?.note).toBeUndefined();
  });

  it("marks a search that fell short of the target", () => {
    const [, webp] = panesFor({
      webp: {
        ...foundWebp(20_000),
        found: {
          target: 80,
          response: webpSearch({ bytes: 20_000, reached: false }),
        },
      },
    });

    expect(webp?.reached).toBe(false);
  });

  it("gives a same-format file one pane with no slider", () => {
    const file = sameResult();

    if (!canCompare(file)) {
      throw new Error("the result should be comparable");
    }

    const panes = panesOf(file, () => undefined);

    expect(panes).toHaveLength(1);
    expect(panes[0]?.kept).toBe(true);
    expect(panes[0]?.format).toBeUndefined();
  });
});

describe("runTarget", () => {
  it("resolves a preset and passes a number through", () => {
    expect(runTarget({ target: "web" })).toBe(70);
    expect(runTarget({ target: 83 })).toBe(83);
  });
});

describe("paneKey", () => {
  it("tells one image's panes from another's", () => {
    expect(paneKey("file/1/a.png", "avif")).not.toBe(
      paneKey("file/2/a.png", "avif")
    );
  });
});

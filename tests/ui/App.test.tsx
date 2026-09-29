import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "../../src/pipeline/types.js";
import SCHEMA_VERSION from "../../src/schema/version.js";
import App from "../../ui/src/App.js";
import { jsonResponse, stubFetch } from "./fetchStub.js";
import { suiteResult } from "./results.js";

const FILES = {
  root: "/home/me/site",
  files: [
    { ref: "root/photos/cat.png", bytes: 100_000 },
    { ref: "root/logo.svg", bytes: 2_000 },
  ],
};

/**
 * Returns a suite run of `photos/cat.png` as the server streams it.
 */
function suiteRun(): PipelineEvent[] {
  return [
    {
      type: "run-start",
      schemaVersion: SCHEMA_VERSION,
      tool: { version: "0.1.0", sharp: "0.35.4", libvips: "8.18.6" },
      options: {
        to: "suite",
        target: 80,
        inPlace: false,
        overwrite: false,
        dryRun: false,
        stripAll: false,
        concurrency: 1,
      },
      files: 1,
    },
    { type: "file-start", index: 0, input: "root/photos/cat.png" },
    { type: "file-done", index: 0, file: suiteResult() },
    {
      type: "run-done",
      totals: {
        files: 1,
        optimised: 1,
        keptOriginal: 0,
        skipped: 0,
        failed: 0,
        inputBytes: 100_000,
        outputBytes: 82_400,
        saving: 0.176,
      },
    },
  ];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("lists the folder's images and runs the ones picked, in suite mode at the web target to start", async () => {
    const events = suiteRun()
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join("");
    const fetchMock = stubFetch({
      "/api/files": () => jsonResponse(FILES),
      "/api/optimise": () =>
        new Response(events, {
          headers: { "content-type": "text/event-stream" },
        }),
    });

    render(<App />);

    expect(await screen.findByText("photos/cat.png")).toBeDefined();
    expect(screen.getByText("2 of 2 picked")).toBeDefined();

    fireEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement); // logo.svg
    expect(
      screen.getByText("wio photos/cat.png --to suite --target web")
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Run 1 image" }));

    expect(
      await screen.findByText(
        "1 file: 1 optimised. 100 kB -> 82.4 kB, 17.6% smaller."
      )
    ).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/optimise",
      expect.objectContaining({
        body: JSON.stringify({
          files: ["root/photos/cat.png"],
          to: "suite",
          target: "web",
        }),
      })
    );
    expect(
      screen.getByRole("button", { name: "Compare photos/cat.png" })
    ).toBeDefined();
    expect(screen.queryByRole("note")).toBeNull(); // nothing blocked
  });

  it("notes the files the copied command would fail or skip once the run is done", async () => {
    const [start, fileStart, fileDone, runDone] = suiteRun();
    const cli = { index: 0, reason: "input", ref: "root/photos/cat.png" };
    const stream = [
      ...[start, fileStart, fileDone].map(
        (event) => `data: ${JSON.stringify(event)}\n\n`
      ),
      `event: cli\ndata: ${JSON.stringify(cli)}\n\n`,
      `data: ${JSON.stringify(runDone)}\n\n`,
    ].join("");

    stubFetch({
      "/api/files": () => jsonResponse(FILES),
      "/api/optimise": () =>
        new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        }),
    });
    render(<App />);
    await screen.findByText("photos/cat.png");
    fireEvent.click(screen.getByRole("button", { name: "Run 2 images" }));

    const note = await screen.findByRole("note");

    expect(note.textContent).toBe(
      "Run as copied, this command would fail 1 file, whose output replaces its original (add --in-place to allow it):photos/cat.png fails"
    );

    fireEvent.click(screen.getByRole("radio", { name: "WebP" }));
    expect(screen.queryByRole("note")).toBeNull(); // another command now
  });
});

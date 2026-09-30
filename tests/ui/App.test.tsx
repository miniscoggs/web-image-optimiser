import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineEvent } from "../../src/pipeline/types.js";
import METADATA_SUMMARY from "../../src/rights/metadataSummary.js";
import SCHEMA_VERSION from "../../src/schema/version.js";
import App from "../../ui/src/App.js";
import { jsonResponse, stubFetch } from "./fetchStub.js";
import { suiteResult } from "./results.js";
import { openedOf, stubWio } from "./wioStub.js";

const CAT = "file/1/cat.png";
const DOG = "file/2/dog.png";
const SETTLED = { timeout: 3000 }; // the options settle for 300 ms before a run starts

/**
 * Returns the events of a suite run over files, as the app api streams them.
 *
 * @param refs - The files' refs.
 */
function eventsOf(refs: string[]) {
  const events: PipelineEvent[] = [
    {
      type: "run-start",
      schemaVersion: SCHEMA_VERSION,
      tool: { version: "0.1.0", sharp: "0.35.4", libvips: "8.18.6" },
      options: {
        to: "suite",
        target: 70,
        inPlace: false,
        overwrite: false,
        dryRun: false,
        stripAll: false,
        concurrency: 1,
      },
      files: refs.length,
    },
    ...refs.flatMap((ref, index): PipelineEvent[] => [
      { type: "file-start", index, input: ref },
      { type: "file-done", index, file: suiteResult(ref) },
    ]),
    {
      type: "run-done",
      totals: {
        files: refs.length,
        optimised: refs.length,
        keptOriginal: 0,
        skipped: 0,
        failed: 0,
        inputBytes: 100_000 * refs.length,
        outputBytes: 82_400 * refs.length,
        saving: 0.176,
      },
    },
  ];

  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

/**
 * Answers a run request with the events of the files it names.
 *
 * @param body - The request's body.
 */
function runResponse(body: unknown) {
  return new Response(eventsOf((body as { files: string[] }).files), {
    headers: { "content-type": "text/event-stream" },
  });
}

/**
 * Returns the files each run was asked for.
 *
 * @param fetchMock - The fetch stub.
 */
function runsOf(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls
    .filter(([path]) => path === "/api/optimise")
    .map(
      ([, init]) =>
        (JSON.parse(init?.body as string) as { files: string[] }).files
    );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("starts on a drop zone, whose Browse button and dropped files call the bridge", async () => {
    const { bridge } = stubWio();

    stubFetch({ "/api/optimise": runResponse });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(bridge.openFiles).toHaveBeenCalledOnce();

    const file = new File(["x"], "cat.png", { type: "image/png" });

    fireEvent.drop(screen.getByRole("region", { name: "Open images" }), {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    await waitFor(() => {
      expect(bridge.openDropped).toHaveBeenCalledWith([file]);
    });
  });

  it("shows why a file wasn't opened", async () => {
    stubWio({
      openFiles: vi.fn(() =>
        Promise.resolve({
          outcome: "opened" as const,
          files: [{ name: "notes.txt", error: "Not an image" }],
        })
      ),
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "notes.txt: Not an image"
    );
  });

  it("opens files the app sends as Browse's, and unsubscribes when unmounted", async () => {
    const { send, unsubscribe } = stubWio();
    const fetchMock = stubFetch({ "/api/optimise": runResponse });
    const { unmount } = render(<App />);

    act(() => {
      send(openedOf("cat.png"));
    });
    expect(
      await screen.findByRole("region", { name: "AVIF" }, SETTLED)
    ).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/optimise",
      expect.objectContaining({
        body: JSON.stringify({ files: [CAT], target: "web" }),
      })
    );
    expect(screen.queryByRole("complementary")).toBeNull(); // one image, no slide-over

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("lists several images in a slide-over, and selecting one shows its grid", async () => {
    const { send } = stubWio();

    stubFetch({ "/api/optimise": runResponse });
    render(<App />);
    act(() => {
      send(openedOf("cat.png", "dog.png"));
    });

    const list = await screen.findByRole("complementary", { name: "Images" });

    await waitFor(() => {
      expect(within(list).getAllByText(/^Done/)).toHaveLength(2);
    }, SETTLED);
    expect(screen.getByRole("heading", { name: "cat.png" })).toBeDefined();
    fireEvent.click(within(list).getByRole("button", { name: /dog\.png/ }));
    expect(screen.getByRole("heading", { name: "dog.png" })).toBeDefined();
    expect(within(list).getByText(/2 files: 2 optimised/)).toBeDefined();
  });

  it("runs images opened during a run as the next batch", async () => {
    const { send } = stubWio();
    const first = Promise.withResolvers<void>();
    const fetchMock = stubFetch({
      "/api/optimise": (body) => {
        const { files } = body as { files: string[] };
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            if (files[0] === CAT) {
              await first.promise;
            }
            controller.enqueue(new TextEncoder().encode(eventsOf(files)));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    render(<App />);
    act(() => {
      send(openedOf("cat.png"));
    });
    await waitFor(() => {
      expect(runsOf(fetchMock)).toEqual([[CAT]]);
    }, SETTLED);
    act(() => {
      send({
        outcome: "opened",
        files: [{ ref: DOG, name: "dog.png", bytes: 100_000 }],
      });
    });
    expect(runsOf(fetchMock)).toEqual([[CAT]]); // waits for the first
    first.resolve();
    await waitFor(() => {
      expect(runsOf(fetchMock)).toEqual([[CAT], [DOG]]);
    });
  });

  it("shows the metadata summary in Help, closed with Escape", () => {
    stubWio();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    const help = screen.getByRole("group", { name: "Help" });

    expect(
      within(help).getByText(METADATA_SUMMARY.svg, { exact: false })
    ).toBeDefined();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("group", { name: "Help" })).toBeNull();
  });

  it("rewrites the outputs shown through /api/rights when the metadata options change, without a new run", async () => {
    const { send, bridge } = stubWio({
      loadOptions: () =>
        Promise.resolve({ stripAll: false, rights: { copyright: "Cat Co" } }),
    });
    const fetchMock = stubFetch({
      "/api/optimise": runResponse,
      "/api/rights": (body) =>
        jsonResponse({
          candidates: (body as { candidates: unknown[] }).candidates.map(
            (_candidate, index) => ({
              ref: `session/rights/1/${index}/cat.out`,
              bytes: 120_000,
              saving: -0.2,
              larger: true,
              rights: {},
              rightsAdded: [],
              warnings: [],
            })
          ),
        }),
    });

    render(<App />);
    act(() => {
      send(openedOf("cat.png"));
    });
    await screen.findByRole("region", { name: "AVIF" }, SETTLED);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Remove all metadata" })
    );
    await waitFor(() => {
      expect(
        within(screen.getByRole("region", { name: "AVIF" })).getByText(
          "Larger than the original"
        )
      ).toBeDefined();
    }, SETTLED);

    const bodyOf = (wanted: string) => {
      const call = fetchMock.mock.calls.find(([path]) => path === wanted);

      return JSON.parse(call?.[1]?.body as string) as Record<string, unknown>;
    };
    const rewrite = bodyOf("/api/rights");

    expect(bodyOf("/api/optimise")).toMatchObject({
      rights: { copyright: "Cat Co" },
    });
    expect(rewrite).toMatchObject({
      stripAll: true,
      candidates: [
        { original: CAT, candidate: "session/runs/1/0/cat.avif" },
        { original: CAT, candidate: "session/runs/1/0/cat.webp" },
        { original: CAT, candidate: "session/runs/1/0/cat.png" },
      ],
    });
    expect(rewrite).not.toHaveProperty("rights"); // the api refuses them with stripAll
    expect(runsOf(fetchMock)).toHaveLength(1);
    await waitFor(() => {
      expect(bridge.saveOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ stripAll: true })
      );
    }, SETTLED);
  });

  it("saves the remembered options once they settle, never the defaults while they load", async () => {
    const remembered = { maxWidth: 800, stripAll: false, rights: {} };
    const { bridge } = stubWio({
      loadOptions: () => Promise.resolve(remembered),
    });

    render(<App />);
    await waitFor(() => {
      expect(bridge.saveOptions).toHaveBeenCalled();
    }, SETTLED);
    expect(bridge.saveOptions).toHaveBeenCalledOnce();
    expect(bridge.saveOptions).toHaveBeenCalledWith(remembered);
  });

  it("keeps the rights on an image that finishes while the options are changing", async () => {
    const { send, bridge } = stubWio({
      loadOptions: () =>
        Promise.resolve({ stripAll: false, rights: { copyright: "Cat Co" } }),
    });
    const held = Promise.withResolvers<void>();
    const fetchMock = stubFetch({
      "/api/optimise": (body) => {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            await held.promise;
            controller.enqueue(
              new TextEncoder().encode(
                eventsOf((body as { files: string[] }).files)
              )
            );
            controller.close();
          },
        });

        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    render(<App />);
    act(() => {
      send(openedOf("cat.png"));
    });
    await waitFor(() => {
      expect(runsOf(fetchMock)).toEqual([[CAT]]);
    }, SETTLED);

    const toggle = screen.getByRole("checkbox", {
      name: "Remove all metadata",
    });

    fireEvent.click(toggle);
    fireEvent.click(toggle); // back as the run had them, before they settle
    held.resolve();
    await screen.findByRole("region", { name: "AVIF" });
    await waitFor(() => {
      expect(bridge.saveOptions).toHaveBeenCalledTimes(2); // loaded, then settled again
    }, SETTLED);
    expect(
      fetchMock.mock.calls.filter(([path]) => path === "/api/rights")
    ).toEqual([]);
  });

  it("runs an image again when it's opened after a save replaced its original", async () => {
    const { send } = stubWio({
      saveOutput: vi.fn(() =>
        Promise.resolve({
          outcome: "saved" as const,
          name: "cat.png",
          written: true,
          replacedOriginal: true,
        })
      ),
    });
    const fetchMock = stubFetch({ "/api/optimise": runResponse });

    render(<App />);
    act(() => {
      send(openedOf("cat.png"));
    });

    const webp = await screen.findByRole("region", { name: "WebP" }, SETTLED);

    fireEvent.click(within(webp).getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/The original was replaced/)).toBeDefined();
    act(() => {
      send(openedOf("cat.png"));
    });
    await waitFor(() => {
      expect(runsOf(fetchMock)).toEqual([[CAT], [CAT]]);
    });
    await waitFor(() => {
      expect(screen.queryByText(/The original was replaced/)).toBeNull();
    });
    expect(
      await screen.findByRole("button", { name: "Save suite" })
    ).toBeDefined();
  });

  it("saves every finished image's suite from the slide-over's Save all and the menu's, alike", async () => {
    const { send, sendMenu, bridge } = stubWio({
      saveSuites: vi.fn(() =>
        Promise.resolve({
          outcome: "saved" as const,
          folder: "C:/photos",
          files: [
            {
              original: CAT,
              candidate: "session/runs/1/0/cat.png",
              name: "cat (1).png",
              wanted: "cat.png",
            },
          ],
        })
      ),
    });

    stubFetch({ "/api/optimise": runResponse });
    render(<App />);
    act(() => {
      send(openedOf("cat.png", "dog.png"));
    });

    const list = await screen.findByRole("complementary", { name: "Images" });

    await waitFor(() => {
      expect(within(list).getAllByText(/^Done/)).toHaveLength(2);
    }, SETTLED);

    const suites = [CAT, DOG].map((original) => ({
      original,
      candidates: ["avif", "webp", "png"].map(
        (extension) => `session/runs/1/0/cat.${extension}`
      ),
    }));

    fireEvent.click(within(list).getByRole("button", { name: "Save all" }));
    expect(bridge.saveSuites).toHaveBeenLastCalledWith(suites);
    expect(
      (await screen.findByText(/Saved 1 file to C:\/photos/)).textContent
    ).toBe(
      "Saved 1 file to C:/photos. cat.png was taken, so saved cat (1).png"
    );

    act(() => {
      sendMenu("save-all");
    });
    expect(bridge.saveSuites).toHaveBeenCalledTimes(2);
    expect(bridge.saveSuites).toHaveBeenLastCalledWith(suites);
  });

  it("saves the one image's suite from the menu, and says when nothing has finished", async () => {
    const { send, sendMenu, bridge } = stubWio();

    stubFetch({ "/api/optimise": runResponse });
    render(<App />);
    act(() => {
      sendMenu("save-all");
    });
    expect(await screen.findByText("Nothing to save yet")).toBeDefined();
    expect(bridge.saveSuites).not.toHaveBeenCalled();

    act(() => {
      send(openedOf("cat.png"));
    });
    await screen.findByRole("region", { name: "AVIF" }, SETTLED);
    act(() => {
      sendMenu("save-all");
    });
    expect(bridge.saveSuites).toHaveBeenCalledOnce();
    expect(bridge.saveSuites).toHaveBeenCalledWith([
      expect.objectContaining({ original: CAT }),
    ]);
  });
});

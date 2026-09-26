import { describe, expect, it } from "vitest";
import type {
  PipelineEvent,
  PipelineFileResult,
} from "../../src/pipeline/types.js";
import { runResultSchema } from "../../src/schema/contract.js";
import SCHEMA_VERSION from "../../src/schema/version.js";
import { IDLE_RUN, runReducer, toRunResult } from "../../ui/src/runState.js";
import type { RunAction, RunState } from "../../ui/src/runState.js";

const START: PipelineEvent = {
  type: "run-start",
  schemaVersion: SCHEMA_VERSION,
  tool: { version: "0.1.0", sharp: "0.35.4", libvips: "8.18.6" },
  options: {
    to: "webp",
    target: 80,
    inPlace: false,
    overwrite: false,
    dryRun: false,
    concurrency: 2,
  },
  files: 2,
};

const TOTALS = {
  files: 2,
  optimised: 1,
  keptOriginal: 0,
  skipped: 0,
  failed: 1,
  inputBytes: 100,
  outputBytes: 40,
  saving: 0.6,
};

/**
 * Returns a finished file's result.
 *
 * @param input - The file's ref.
 * @param failed - Whether it failed.
 */
function resultOf(input: string, failed: boolean): PipelineFileResult {
  return failed
    ? {
        input,
        status: "failed",
        outputs: [],
        warnings: [],
        error: { code: "E_ANIMATED", message: "Animated" },
      }
    : {
        input,
        status: "optimised",
        bytes: 100,
        width: 8,
        height: 8,
        outputs: [
          {
            role: "webp",
            path: "session/runs/1/0/a.webp",
            format: "webp",
            method: "lossless",
            bytes: 40,
            saving: 0.6,
            score: 100,
            verdict: "visually-lossless",
            strippedMetadata: [],
          },
        ],
        warnings: [],
      };
}

/**
 * Applies actions to a run in turn.
 *
 * @param actions - The actions.
 * @param state - The run to start from.
 */
function reduce(actions: RunAction[], state: RunState = IDLE_RUN) {
  return actions.reduce(runReducer, state);
}

const BEGIN: RunAction = { type: "begin", refs: ["root/a.png", "root/b.webp"] };

describe("runReducer", () => {
  it("queues the files, then tracks each one by index as its events arrive", () => {
    const started = reduce([
      BEGIN,
      { type: "event", event: START },
      {
        type: "event",
        event: { type: "file-start", index: 1, input: "root/b.webp" },
      },
    ]);

    expect(started.status).toBe("running");
    expect(started.files).toEqual([
      { ref: "root/a.png", running: false },
      { ref: "root/b.webp", running: true },
    ]);

    const result = resultOf("root/b.webp", true);
    const finished = reduce(
      [{ type: "event", event: { type: "file-done", index: 1, file: result } }],
      started
    );

    expect(finished.files[1]).toEqual({
      ref: "root/b.webp",
      running: false,
      result,
    });
    expect(finished.files[0]).toBe(started.files[0]);
  });

  it("ends a run with its totals, and leaves a finished run alone when the stream ends", () => {
    const done = reduce([
      BEGIN,
      { type: "event", event: { type: "run-done", totals: TOTALS } },
    ]);

    expect(done).toMatchObject({ status: "done", totals: TOTALS });
    expect(reduce([{ type: "end" }], done)).toBe(done);
  });

  it("fails a run whose stream ends before run-done", () => {
    expect(reduce([BEGIN, { type: "end" }])).toMatchObject({
      status: "failed",
      error: "The server ended the run before it finished",
    });
  });

  it("stops or fails a run with no file left running", () => {
    const running = reduce([
      BEGIN,
      {
        type: "event",
        event: { type: "file-start", index: 0, input: "root/a.png" },
      },
    ]);
    const stopped = reduce([{ type: "stop" }], running);
    const failed = reduce([{ type: "fail", error: "offline" }], running);

    expect(stopped.status).toBe("stopped");
    expect(failed).toMatchObject({ status: "failed", error: "offline" });
    for (const state of [stopped, failed]) {
      expect(state.files.some((file) => file.running)).toBe(false);
    }
  });

  it("starts afresh on the next run", () => {
    const failed = reduce([BEGIN, { type: "fail", error: "offline" }]);

    expect(reduce([BEGIN], failed)).toEqual({
      status: "running",
      files: [
        { ref: "root/a.png", running: false },
        { ref: "root/b.webp", running: false },
      ],
    });
  });
});

describe("toRunResult", () => {
  it("builds a valid RunResult once every file and the totals are in", () => {
    const events: PipelineEvent[] = [
      START,
      { type: "file-done", index: 1, file: resultOf("root/b.webp", true) },
      { type: "file-done", index: 0, file: resultOf("root/a.png", false) },
      { type: "run-done", totals: TOTALS },
    ];
    const states = events.map((_event, count) =>
      reduce([
        BEGIN,
        ...events
          .slice(0, count + 1)
          .map((event): RunAction => ({ type: "event", event })),
      ])
    );
    const result = toRunResult(states.at(-1) ?? IDLE_RUN);

    expect(states.slice(0, -1).map(toRunResult)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(runResultSchema.parse(result)).toEqual(result);
    expect(result?.files.map((file) => file.input)).toEqual([
      "root/a.png",
      "root/b.webp",
    ]);
  });
});

import type {
  PipelineEvent,
  PipelineFileResult,
  PipelineRunResult,
} from "../../src/pipeline/types.js";

/**
 * One file of a run: its ref, whether it is being worked on, and its result once done.
 */
type RunFile = { ref: string; running: boolean; result?: PipelineFileResult };

/**
 * A run as the UI shows it, built up from the server's events.
 */
type RunState = {
  status: "idle" | "running" | "done" | "stopped" | "failed";
  files: RunFile[];
  start?: Extract<PipelineEvent, { type: "run-start" }>;
  totals?: PipelineRunResult["totals"];
  error?: string;
};

/**
 * A change to a run: it begins with its files, an event arrives, the stream ends, the person
 * stops it, or the request fails.
 */
type RunAction =
  | { type: "begin"; refs: string[] }
  | { type: "event"; event: PipelineEvent }
  | { type: "end" }
  | { type: "stop" }
  | { type: "fail"; error: string };

const IDLE_RUN: RunState = { status: "idle", files: [] };

/**
 * Changes one file of a run.
 *
 * @param state - The run.
 * @param index - The file's position.
 * @param change - What changes.
 */
function updateFile(
  state: RunState,
  index: number,
  change: Partial<RunFile>
): RunState {
  return {
    ...state,
    files: state.files.map((file, position) =>
      position === index ? { ...file, ...change } : file
    ),
  };
}

/**
 * Ends a run early, with no file left running.
 *
 * @param state - The run.
 * @param status - How it ended.
 * @param error - Why it failed, if it did.
 */
function endEarly(
  state: RunState,
  status: "stopped" | "failed",
  error?: string
): RunState {
  return {
    ...state,
    status,
    files: state.files.map((file) => ({ ...file, running: false })),
    ...(error === undefined ? {} : { error }),
  };
}

/**
 * Applies one of the server's events to a run.
 *
 * @param state - The run.
 * @param event - The event.
 */
function applyEvent(state: RunState, event: PipelineEvent): RunState {
  switch (event.type) {
    case "run-start":
      return { ...state, start: event };
    case "file-start":
      return updateFile(state, event.index, { running: true });
    case "file-done":
      return updateFile(state, event.index, {
        running: false,
        result: event.file,
      });
    case "run-done":
      return { ...state, status: "done", totals: event.totals };
  }
}

/**
 * Returns a run after an action.
 *
 * @param state - The run.
 * @param action - The action.
 */
function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case "begin":
      return {
        status: "running",
        files: action.refs.map((ref) => ({ ref, running: false })),
      };
    case "event":
      return applyEvent(state, action.event);
    case "end":
      return state.status === "running"
        ? endEarly(
            state,
            "failed",
            "The server ended the run before it finished"
          )
        : state;
    case "stop":
      return endEarly(state, "stopped");
    case "fail":
      return endEarly(state, "failed", action.error);
  }
}

/**
 * Returns a finished run's `RunResult`, as `wio --json` prints it but with refs in place of
 * paths, or `undefined` until the run is done.
 *
 * @param state - The run.
 */
function toRunResult(state: RunState): PipelineRunResult | undefined {
  const files = state.files.flatMap((file) => file.result ?? []);

  if (
    state.start === undefined ||
    state.totals === undefined ||
    files.length !== state.files.length
  ) {
    return undefined;
  }
  return {
    schemaVersion: state.start.schemaVersion,
    tool: state.start.tool,
    options: state.start.options,
    files,
    totals: state.totals,
  };
}

export { IDLE_RUN, runReducer, toRunResult };
export type { RunAction, RunFile, RunState };

import { useReducer, useRef } from "react";
import { messageOf, runFiles } from "./api.js";
import type { RunOptions } from "./api.js";
import { IDLE_RUN, runReducer } from "./runState.js";

/**
 * Runs files on the server one batch at a time, keeping the run's state as its events arrive.
 *
 * @returns The run, a function that starts one, and one that stops it.
 */
function useRun() {
  const [run, dispatch] = useReducer(runReducer, IDLE_RUN);
  const controller = useRef<AbortController>(undefined);

  const start = async (refs: string[], options: RunOptions) => {
    const abort = new AbortController();

    controller.current = abort;
    dispatch({ type: "begin", refs });
    try {
      for await (const event of runFiles(refs, options, abort.signal)) {
        dispatch({ type: "event", event });
      }
      dispatch({ type: "end" });
    } catch (error) {
      dispatch(
        abort.signal.aborted
          ? { type: "stop" }
          : { type: "fail", error: messageOf(error) }
      );
    }
  };

  const stop = () => {
    controller.current?.abort(); // closing the stream stops the run on the server
  };

  return { run, start, stop };
}

export default useRun;

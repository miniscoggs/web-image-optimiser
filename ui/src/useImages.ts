import { useEffect, useReducer, useRef, useState } from "react";
import type {
  PipelineFileResult,
  PipelineRunResult,
} from "../../src/pipeline/types.js";
import { messageOf, rewriteRights, runFiles } from "./api.js";
import type { RunSettings } from "./api.js";
import { imagesReducer, queuedRefs } from "./images.js";
import type { OpenedImage, RewrittenImage } from "./images.js";

/**
 * Returns what a run's metadata options come to, to tell whether two runs' differ.
 *
 * @param settings - The settings.
 */
function metadataOf(settings: RunSettings | undefined) {
  return JSON.stringify([settings?.stripAll, settings?.rights]);
}

/**
 * Keeps the opened images and runs them in `suite` mode, one batch at a time: images opened
 * during a run wait for the next batch. A change to the maximum width runs every image again,
 * and a change to the metadata options rewrites the outputs shown without a new run.
 *
 * @param settings - What a run takes, or `undefined` while the options are still loading or
 * being changed, when nothing starts.
 * @returns The images, whether a run is under way, the last run's totals, why the last rewrite
 * failed, and functions that open more images and mark an image's original as replaced.
 */
function useImages(settings: RunSettings | undefined) {
  const [images, dispatch] = useReducer(imagesReducer, []);
  const [totals, setTotals] = useState<PipelineRunResult["totals"]>();
  const [, setBatches] = useState(0); // a render when a run ends, for the next batch to start
  const [problem, setProblem] = useState<string>();
  const controller = useRef<AbortController>(undefined);
  const latest = useRef({ settings, images });
  const ran = useRef<RunSettings>(undefined);
  const rewrites = useRef(0);
  const previous = useRef<RunSettings>(undefined);
  const unsettled = useRef<{ ref: string; result: PipelineFileResult }[]>([]); // finished while the options were changing

  useEffect(() => {
    latest.current = { settings, images };
  });

  const rewrite = async (
    finished: { ref: string; result: PipelineFileResult }[],
    current: boolean
  ) => {
    const wanted = current ? (rewrites.current += 1) : rewrites.current;
    const candidates = finished.flatMap(({ ref, result }) =>
      result.outputs.map((output) => ({
        original: ref,
        candidate: output.path,
      }))
    );

    if (candidates.length === 0) {
      return;
    }
    try {
      const response = await rewriteRights(candidates, {
        stripAll: latest.current.settings?.stripAll,
        rights: latest.current.settings?.rights,
      });

      if (wanted === rewrites.current) {
        let next = 0;
        const rewritten = finished.map(({ ref, result }): RewrittenImage => {
          const count = result.outputs.length;
          const own = response.slice(next, next + count);

          next += count;
          return { ref, candidates: own };
        });

        dispatch({ type: "rights", rewritten });
        setProblem(undefined);
      }
    } catch (error) {
      setProblem(`Couldn't change the metadata: ${messageOf(error)}`);
    }
  };

  const run = async (refs: string[], runSettings: RunSettings) => {
    const abort = new AbortController();

    controller.current = abort;
    ran.current = runSettings;
    try {
      for await (const event of runFiles(refs, runSettings, abort.signal)) {
        if (abort.signal.aborted) {
          return;
        }
        if (event.type === "file-start") {
          dispatch({ type: "start", ref: event.input });
        } else if (event.type === "file-done") {
          const finished = { ref: event.file.input, result: event.file };

          dispatch({ type: "finish", result: event.file });
          if (latest.current.settings === undefined) {
            unsettled.current.push(finished);
          } else if (
            metadataOf(latest.current.settings) !== metadataOf(runSettings)
          ) {
            void rewrite([finished], false); // the options changed while it ran
          }
        } else if (event.type === "run-done") {
          setTotals(event.totals);
        }
      }
      if (!abort.signal.aborted) {
        dispatch({
          type: "fail",
          refs,
          error: "The app ended the run before it finished",
        });
      }
    } catch (error) {
      if (!abort.signal.aborted) {
        dispatch({ type: "fail", refs, error: messageOf(error) });
      }
    } finally {
      if (controller.current === abort) {
        controller.current = undefined;
        setBatches((count) => count + 1);
      }
    }
  };

  useEffect(() => {
    if (settings === undefined || controller.current !== undefined) {
      return;
    }

    const refs = queuedRefs(images);

    if (refs.length > 0) {
      void run(refs, settings);
    }
  });

  useEffect(() => {
    if (settings === undefined) {
      return;
    }

    const before = previous.current;
    const waiting = unsettled.current;

    previous.current = settings;
    unsettled.current = [];
    if (before === undefined) {
      return;
    }
    if (before.maxWidth !== settings.maxWidth) {
      controller.current?.abort();
      controller.current = undefined;
      setTotals(undefined);
      dispatch({ type: "requeue" });
    } else if (metadataOf(before) !== metadataOf(settings)) {
      const finished = latest.current.images.flatMap(({ ref, result }) =>
        result === undefined || result.status === "failed"
          ? []
          : [{ ref, result }]
      );

      void rewrite(finished, true);
    } else if (metadataOf(ran.current) !== metadataOf(settings)) {
      void rewrite(waiting, false); // they finished under the run's options, which these replaced
    }
  }, [settings]);

  const add = (files: Pick<OpenedImage, "ref" | "name" | "bytes">[]) => {
    dispatch({ type: "add", files });
  };

  const markReplaced = (ref: string) => {
    dispatch({ type: "replaced", ref });
  };

  const running = images.some(
    (image) => image.status === "queued" || image.status === "processing"
  );

  return { images, running, totals, problem, add, markReplaced };
}

export default useImages;

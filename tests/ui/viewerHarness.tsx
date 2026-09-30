import { useState } from "react";
import type { AppSearchResponse } from "../../src/app/api.js";
import type { RunSettings } from "../../ui/src/api.js";
import type { ComparisonFile } from "../../ui/src/comparison.js";
import ComparisonViewer from "../../ui/src/components/ComparisonViewer.js";
import { runTarget } from "../../ui/src/panes.js";
import useSaves from "../../ui/src/useSaves.js";
import useTargetSearches from "../../ui/src/useTargetSearches.js";

// the viewer's tools live in the app, so its tests give it the app's hooks

const SETTINGS: RunSettings = { target: "web" };

/**
 * Renders a viewer with the app's slider and save state.
 *
 * @param props - The file to compare.
 */
function ViewerHarness({ file }: { file: ComparisonFile }) {
  const [replaced, setReplaced] = useState(false);
  const searches = useTargetSearches(SETTINGS);
  const saves = useSaves(() => {
    setReplaced(true);
  });

  return (
    <ComparisonViewer
      file={file}
      name="cat.png"
      replaced={replaced}
      tools={{ target: runTarget(SETTINGS), searches, saves }}
    />
  );
}

/**
 * Returns what `/api/search` answers for a WebP.
 *
 * @param search - The fields to change.
 */
function webpSearch(
  search: Partial<AppSearchResponse> = {}
): AppSearchResponse {
  return {
    ref: "session/searches/1/cat.webp",
    format: "webp",
    method: "lossy",
    quality: 85,
    bytes: 20_000,
    saving: 0.8,
    score: 90.5,
    verdict: "excellent",
    reached: true,
    warnings: [],
    ...search,
  };
}

export { ViewerHarness, webpSearch };

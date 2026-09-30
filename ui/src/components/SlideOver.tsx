import { formatBytes, formatPercent } from "../../../src/cli/format.js";
import type { OpenedImage } from "../images.js";
import { imageUrl } from "../refs.js";

/**
 * {@link SlideOver}'s props: the images, the one selected, the run's totals in words, and what
 * selecting an image, opening more and saving all do.
 */
type SlideOverProps = {
  images: OpenedImage[];
  selected: string | undefined;
  summary: string | undefined;
  onSelect: (ref: string) => void;
  onOpenMore: () => void;
  onSaveAll?: () => void; // Save all is off until it has something to call
};

const STATUS_LABELS = {
  queued: "Queued",
  processing: "Processing",
  done: "Done",
  failed: "Failed",
} as const;

/**
 * Returns what an image's row says of it: its status, and its saving once done.
 *
 * @param image - The image.
 */
function statusOf(image: OpenedImage) {
  const bytes = image.result?.outputs[0]?.saving;

  return image.status === "done" && bytes !== undefined
    ? `Done, ${formatPercent(bytes)} smaller`
    : STATUS_LABELS[image.status];
}

/**
 * Renders the left-hand drawer listing every opened image with its thumbnail, name, status and
 * saving, with Open more above the list and Save all and the run's totals below it.
 *
 * @param props - The images and what the buttons do.
 */
function SlideOver({
  images,
  selected,
  summary,
  onSelect,
  onOpenMore,
  onSaveAll,
}: SlideOverProps) {
  return (
    <aside className="slide-over" aria-label="Images">
      <button type="button" onClick={onOpenMore}>
        Open more
      </button>
      <ul className="image-list">
        {images.map((image) => (
          <li key={image.ref}>
            <button
              type="button"
              className="image-row"
              aria-current={image.ref === selected}
              title={image.error}
              onClick={() => {
                onSelect(image.ref);
              }}
            >
              <img className="thumb" src={imageUrl(image.ref)} alt="" />
              <span className="file-name">{image.name}</span>
              <span className="file-size">{formatBytes(image.bytes)}</span>
              <span
                className="image-status"
                data-status={image.status}
                role="status"
              >
                {statusOf(image)}
              </span>
              {image.error !== undefined && (
                <span className="pane-error">{image.error}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <footer>
        {summary !== undefined && <p className="muted">{summary}</p>}
        <button
          type="button"
          disabled={onSaveAll === undefined}
          onClick={onSaveAll}
        >
          Save all
        </button>
      </footer>
    </aside>
  );
}

export default SlideOver;
export type { SlideOverProps };

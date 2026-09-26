import { useState } from "react";
import type { DragEvent } from "react";
import { formatBytes } from "../../../src/cli/format.js";
import type { ServerListedFile } from "../../../src/server/api.js";
import { displayName, imageUrl, isUpload } from "../refs.js";

const ACCEPT = ".avif,.jpg,.jpeg,.png,.svg,.webp";

/**
 * {@link FileList}'s props: the images, which of them are left out of a run, whether an upload
 * is in progress, and what to do when the selection changes, files are added or the list needs
 * reloading.
 */
type FileListProps = {
  files: ServerListedFile[];
  excluded: ReadonlySet<string>;
  uploading: boolean;
  onExcludedChange: (excluded: ReadonlySet<string>) => void;
  onUpload: (files: File[]) => void;
  onRefresh: () => void;
};

/**
 * Returns whether a drag carries files, rather than text or a link.
 *
 * @param event - The drag event.
 */
function carriesFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Renders the images to pick from, with a drop zone that uploads more.
 *
 * @param props - The images and the handlers.
 */
function FileList({
  files,
  excluded,
  uploading,
  onExcludedChange,
  onUpload,
  onRefresh,
}: FileListProps) {
  const [dragging, setDragging] = useState(false);
  const selected = files.filter((file) => !excluded.has(file.ref)).length;

  const toggle = (ref: string) => {
    const next = new Set(excluded);

    if (!next.delete(ref)) {
      next.add(ref);
    }
    onExcludedChange(next);
  };

  return (
    <aside
      className="files"
      aria-label="Images"
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        if (carriesFiles(event)) {
          event.preventDefault(); // allows the drop
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        onUpload([...event.dataTransfer.files]);
      }}
    >
      <div className="files-head">
        <h2>Images</h2>
        <span className="muted">
          {selected} of {files.length} picked
        </span>
        <div className="files-tools">
          <button
            type="button"
            className="quiet"
            onClick={() => {
              onExcludedChange(new Set());
            }}
          >
            All
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              onExcludedChange(new Set(files.map((file) => file.ref)));
            }}
          >
            None
          </button>
          <button type="button" className="quiet" onClick={onRefresh}>
            Refresh
          </button>
        </div>
      </div>
      <label className="drop-zone">
        <input
          type="file"
          multiple
          accept={ACCEPT}
          className="visually-hidden"
          onChange={(event) => {
            onUpload([...(event.target.files ?? [])]);
            event.target.value = ""; // so picking the same file again uploads it again
          }}
        />
        {uploading ? (
          "Uploading..."
        ) : (
          <span>
            Drop images here, or <u>choose files</u>
          </span>
        )}
      </label>
      {files.length === 0 ? (
        <p className="empty">No images in this folder yet.</p>
      ) : (
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.ref}>
              <label className="file">
                <input
                  type="checkbox"
                  checked={!excluded.has(file.ref)}
                  onChange={() => {
                    toggle(file.ref);
                  }}
                />
                <img
                  className="thumb"
                  src={imageUrl(file.ref)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="file-name">
                  {displayName(file.ref)}
                  {isUpload(file.ref) && (
                    <span className="badge">uploaded</span>
                  )}
                </span>
                <span className="file-size">{formatBytes(file.bytes)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export default FileList;
export type { FileListProps };

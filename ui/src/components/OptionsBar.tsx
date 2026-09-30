import { useState } from "react";
import type { AppOptions } from "../../../src/app/api.js";
import {
  PIPELINE_RIGHTS_OPTIONS,
  isMaxWidth,
  rightsFieldError,
} from "../../../src/pipeline/resolveSettings.js";
import type { PipelineRightsOptions } from "../../../src/pipeline/types.js";
import HelpPopover from "./HelpPopover.js";
import Popover from "./Popover.js";

/**
 * {@link OptionsBar}'s props: the options, what changing them does, whether the rights panel is
 * open, and what opening or closing it does.
 */
type OptionsBarProps = {
  options: AppOptions;
  onChange: (options: AppOptions) => void;
  rightsOpen: boolean;
  onRightsOpenChange: (open: boolean) => void;
};

const RIGHTS_LABELS = {
  creator: "Creator",
  credit: "Credit Line",
  copyright: "Copyright Notice",
  rightsUrl: "Rights URL",
  licensorUrl: "Licensor URL",
} as const satisfies Record<keyof PipelineRightsOptions, string>;

/**
 * Renders the toolbar's options: the maximum width, Remove all metadata, the rights fields in a
 * panel, and Help.
 *
 * @param props - The options and what changes them.
 */
function OptionsBar({
  options,
  onChange,
  rightsOpen,
  onRightsOpenChange,
}: OptionsBarProps) {
  const [width, setWidth] = useState(options.maxWidth?.toString() ?? "");
  const widthInvalid = width !== "" && !isMaxWidth(Number(width));

  return (
    <div className="options-bar">
      <label className="field">
        Max width
        <input
          type="number"
          min={1}
          step={1}
          placeholder="none"
          value={width}
          aria-invalid={widthInvalid}
          onChange={(event) => {
            const text = event.currentTarget.value;
            const value = Number(text);

            setWidth(text);
            if (text === "") {
              onChange({ ...options, maxWidth: undefined });
            } else if (isMaxWidth(value)) {
              onChange({ ...options, maxWidth: value });
            }
          }}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={options.stripAll}
          onChange={(event) => {
            onChange({ ...options, stripAll: event.currentTarget.checked });
          }}
        />
        Remove all metadata
      </label>
      <Popover
        label="Rights info"
        open={rightsOpen}
        onOpenChange={onRightsOpenChange}
      >
        <p className="muted">
          Fills only the fields an image lacks.
          {options.stripAll && " Turned off by Remove all metadata."}
        </p>
        {PIPELINE_RIGHTS_OPTIONS.map((name) => {
          const value = options.rights[name] ?? "";
          const error =
            value === "" ? undefined : rightsFieldError(name, value);

          return (
            <label key={name} className="field stacked">
              {RIGHTS_LABELS[name]}
              <input
                type="text"
                value={value}
                disabled={options.stripAll}
                aria-invalid={error !== undefined}
                onChange={(event) => {
                  const text = event.currentTarget.value;
                  const others = Object.fromEntries(
                    Object.entries(options.rights).filter(
                      ([field]) => field !== name
                    )
                  );

                  onChange({
                    ...options,
                    rights: text === "" ? others : { ...others, [name]: text },
                  });
                }}
              />
              {error !== undefined && (
                <span className="pane-error" role="alert">
                  {error}
                </span>
              )}
            </label>
          );
        })}
      </Popover>
      <HelpPopover />
    </div>
  );
}

export default OptionsBar;
export type { OptionsBarProps };

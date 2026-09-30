import { useState } from "react";
import METADATA_SUMMARY from "../../../src/rights/metadataSummary.js";
import Popover from "./Popover.js";

/**
 * Renders the toolbar's Help button and its panel, which says what the outputs keep and remove
 * of an image's metadata.
 */
function HelpPopover() {
  const [open, setOpen] = useState(false);

  return (
    <Popover label="Help" open={open} onOpenChange={setOpen}>
      <h2>Metadata</h2>
      <p>
        <strong>Kept:</strong> {METADATA_SUMMARY.kept}
      </p>
      <p>
        <strong>Removed:</strong> {METADATA_SUMMARY.removed}
      </p>
      <p>SVGs {METADATA_SUMMARY.svg}</p>
      <p>
        Remove all metadata removes the kept fields too; Rights info adds fields
        an image lacks.
      </p>
    </Popover>
  );
}

export default HelpPopover;

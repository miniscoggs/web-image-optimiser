import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { ViewportSize } from "./viewport.js";

/**
 * Returns an element's content size in CSS pixels, kept up to date as it changes, and zero until
 * it is first measured.
 *
 * @param ref - The element.
 */
function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return size;
}

export default useElementSize;

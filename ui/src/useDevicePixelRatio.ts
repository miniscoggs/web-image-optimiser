import { useEffect, useState } from "react";

/**
 * Returns the display's device pixels per CSS pixel, kept up to date as the page is zoomed or
 * its window moves to another display.
 */
function useDevicePixelRatio() {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio);

  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`); // stops matching once the ratio changes
    const update = () => {
      setRatio(window.devicePixelRatio);
    };

    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, [ratio]);
  return ratio;
}

export default useDevicePixelRatio;

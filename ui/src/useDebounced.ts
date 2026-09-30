import { useEffect, useState } from "react";

/**
 * Returns a value once it has stopped changing for a while, so typing in a field asks for one
 * run rather than one per key.
 *
 * @param value - The value.
 * @param delay - How long it must rest, in milliseconds.
 */
function useDebounced<Value>(value: Value, delay: number) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return settled;
}

export default useDebounced;

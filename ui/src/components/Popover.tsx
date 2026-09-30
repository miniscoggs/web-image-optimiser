import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * {@link Popover}'s props: the label of the button that opens it, whether it is open, what
 * opening and closing do, and what it holds.
 */
type PopoverProps = {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
};

/**
 * Renders a button that opens a small panel beside it, closed with Escape, a click outside it
 * or the button again.
 *
 * @param props - The button's label, the panel's state and what it holds.
 */
function Popover({ label, open, onOpenChange, children }: PopoverProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          onOpenChange(false);
        }
      } else if (!container.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [open, onOpenChange]);

  return (
    <div className="popover" ref={container}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          onOpenChange(!open);
        }}
      >
        {label}
      </button>
      {open && (
        <div className="popover-panel" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

export default Popover;
export type { PopoverProps };

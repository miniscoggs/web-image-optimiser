import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

/**
 * {@link WipeDivider}'s props: where the divider is, as a fraction of the pane's width from its
 * left, and what moving it does.
 */
type WipeDividerProps = {
  position: number;
  onChange: (position: number) => void;
};

const KEY_STEP = 0.05;

/**
 * Keeps a position within the pane.
 *
 * @param position - The position, as a fraction of the pane's width.
 */
function withinPane(position: number) {
  return Math.min(Math.max(position, 0), 1);
}

/**
 * Renders a wipe's divider across its pane, which a drag or the arrow keys move.
 *
 * @param props - The position and its setter.
 */
function WipeDivider({ position, onChange }: WipeDividerProps) {
  const track = useRef<HTMLDivElement>(null);

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = track.current?.getBoundingClientRect();

    if (bounds !== undefined && bounds.width > 0) {
      onChange(withinPane((event.clientX - bounds.left) / bounds.width));
    }
  };

  const press = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation(); // so the viewport doesn't pan
    event.currentTarget.setPointerCapture(event.pointerId);
    follow(event);
  };

  const pressKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Partial<Record<string, number>> = {
      ArrowLeft: position - KEY_STEP,
      ArrowRight: position + KEY_STEP,
      Home: 0,
      End: 1,
    };
    const next = moves[event.key];

    if (next === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onChange(withinPane(next));
  };

  const percent = Math.round(position * 100);

  return (
    <div ref={track} className="wipe-track">
      <div
        className="wipe-divider"
        role="slider"
        tabIndex={0}
        aria-label="Wipe position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% original`}
        style={{ left: `${position * 100}%` }}
        onPointerDown={press}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            follow(event);
          }
        }}
        onKeyDown={pressKey}
      />
    </div>
  );
}

export default WipeDivider;
export type { WipeDividerProps };

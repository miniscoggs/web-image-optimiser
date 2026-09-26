import { useEffect, useRef } from "react";
import type {
  Dispatch,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  SetStateAction,
} from "react";
import useElementSize from "../useElementSize.js";
import {
  layoutOf,
  panBy,
  wheelZoomFactor,
  zoomAt,
  zoomOf,
} from "../viewport.js";
import type { Viewport, ViewportPoint, ViewportSize } from "../viewport.js";

/**
 * An image a viewport draws over the ones before it: faded to an opacity, or cut off a fraction
 * of the pane's width from its right edge.
 */
type ImageViewportLayer = {
  src: string;
  alt: string;
  opacity?: number;
  clipRight?: number;
};

/**
 * {@link ImageViewport}'s props: what it shows, the view it shares with the other panes, and
 * what a click without a drag does.
 */
type ImageViewportProps = {
  label: string;
  image: ViewportSize;
  view: Viewport;
  pixelRatio: number;
  onViewChange: Dispatch<SetStateAction<Viewport>>;
  layers: ImageViewportLayer[];
  onSelect?: () => void;
  children?: ReactNode;
};

/**
 * A pointer held down on the viewport: where it was last, and how far it has moved.
 */
type Drag = { pointerId: number; last: ViewportPoint; travelled: number };

const CLICK_SLOP = 4; // css pixels a press can move and still be a click

const KEY_PAN = 40;

const KEY_DELTAS: Partial<Record<string, ViewportPoint>> = {
  ArrowLeft: { x: KEY_PAN, y: 0 },
  ArrowRight: { x: -KEY_PAN, y: 0 },
  ArrowUp: { x: 0, y: KEY_PAN },
  ArrowDown: { x: 0, y: -KEY_PAN },
};

/**
 * Renders images stacked in a pane at a shared zoom and pan. Dragging or the arrow keys pan it,
 * and the wheel zooms around the pointer.
 *
 * @param props - The images, the view and its setter.
 */
function ImageViewport({
  label,
  image,
  view,
  pixelRatio,
  onViewChange,
  layers,
  onSelect,
  children,
}: ImageViewportProps) {
  const element = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>(undefined);
  const pane = useElementSize(element);
  const layout = layoutOf(view, image, pane, pixelRatio);

  useEffect(() => {
    const viewport = element.current;

    if (viewport === null) {
      return;
    }

    const zoomByWheel = (event: WheelEvent) => {
      const bounds = viewport.getBoundingClientRect();
      const anchor = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode);

      event.preventDefault();
      onViewChange((current) => {
        const zoom = zoomOf(current, image, pane, pixelRatio) * factor;

        return zoomAt(current, zoom, image, pane, pixelRatio, anchor);
      });
    };

    viewport.addEventListener("wheel", zoomByWheel, { passive: false }); // react's wheel listener is passive, so can't stop the page zooming
    return () => {
      viewport.removeEventListener("wheel", zoomByWheel);
    };
  }, [image, pane, pixelRatio, onViewChange]);

  const press = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      last: { x: event.clientX, y: event.clientY },
      travelled: 0,
    };
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;

    if (held?.pointerId !== event.pointerId) {
      return;
    }

    const delta = {
      x: event.clientX - held.last.x,
      y: event.clientY - held.last.y,
    };

    held.last = { x: event.clientX, y: event.clientY };
    held.travelled += Math.abs(delta.x) + Math.abs(delta.y);
    onViewChange((current) => panBy(current, delta, image, pane, pixelRatio));
  };

  const release = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;

    if (held?.pointerId !== event.pointerId) {
      return;
    }
    drag.current = undefined;
    if (held.travelled < CLICK_SLOP) {
      onSelect?.();
    }
  };

  const pressKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = KEY_DELTAS[event.key];

    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    onViewChange((current) => panBy(current, delta, image, pane, pixelRatio));
  };

  return (
    <div
      ref={element}
      className="viewport"
      role="group"
      aria-label={label}
      tabIndex={0}
      data-pixelated={layout.pixelated || undefined}
      data-selectable={onSelect !== undefined || undefined}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={() => {
        drag.current = undefined;
      }}
      onKeyDown={pressKey}
    >
      {layers.map((layer) => (
        <div
          key={layer.src}
          className="viewport-layer"
          style={{
            opacity: layer.opacity,
            clipPath:
              layer.clipRight === undefined
                ? undefined
                : `inset(0 ${layer.clipRight * 100}% 0 0)`,
          }}
        >
          <img
            src={layer.src}
            alt={layer.alt}
            draggable={false}
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              height: layout.height,
            }}
          />
        </div>
      ))}
      {children}
    </div>
  );
}

export default ImageViewport;
export type { ImageViewportLayer, ImageViewportProps };

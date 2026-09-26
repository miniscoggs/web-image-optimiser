// the zoom and pan every pane of a comparison shares. zoom counts device pixels per image pixel,
// so 1 is true 1:1 whatever the display's scaling, and the centre is the image point in the
// middle of a pane, so panes of one size show the same part of the image

/**
 * A width and height: in CSS pixels for a pane, or image pixels for an image.
 */
type ViewportSize = { width: number; height: number };

/**
 * A position: in image pixels for a view's centre, or CSS pixels from a pane's top left.
 */
type ViewportPoint = { x: number; y: number };

/**
 * How the panes show the image: fitted to the pane, or at a zoom around an image point.
 */
type Viewport = { zoom: "fit" } | { zoom: number; center: ViewportPoint };

/**
 * Where a pane draws the image, in CSS pixels from its top left, at what zoom, and whether its
 * pixels are drawn as squares.
 */
type ViewportLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
  zoom: number;
  pixelated: boolean;
};

const FIT_VIEW: Viewport = { zoom: "fit" };

/**
 * The zooms the viewer offers besides fit: 100%, 200% and 400%.
 */
const ZOOM_PRESETS = [1, 2, 4] as const;

const MAX_ZOOM = 32;

/**
 * Returns the zoom that shows the whole image in a pane, in device pixels per image pixel.
 *
 * @param image - The image's size.
 * @param pane - The pane's size.
 * @param pixelRatio - The display's device pixels per CSS pixel.
 */
function fitZoom(image: ViewportSize, pane: ViewportSize, pixelRatio: number) {
  return (
    Math.min(pane.width / image.width, pane.height / image.height) * pixelRatio
  );
}

/**
 * Returns a view's zoom, working out fit for the pane.
 *
 * @param view - The view.
 * @param image - The image's size.
 * @param pane - The pane's size.
 * @param pixelRatio - The display's device pixels per CSS pixel.
 */
function zoomOf(
  view: Viewport,
  image: ViewportSize,
  pane: ViewportSize,
  pixelRatio: number
) {
  return view.zoom === "fit" ? fitZoom(image, pane, pixelRatio) : view.zoom;
}

/**
 * Keeps one axis of a centre where the image fills the pane, or in the middle when it can't.
 *
 * @param center - The centre on this axis, in image pixels.
 * @param imageLength - The image's length on this axis.
 * @param paneLength - The pane's length on this axis, in CSS pixels.
 * @param scale - CSS pixels per image pixel.
 */
function clampAxis(
  center: number,
  imageLength: number,
  paneLength: number,
  scale: number
) {
  const halfPane = paneLength / 2 / scale; // in image pixels

  if (!(scale > 0) || imageLength <= halfPane * 2) {
    // eg a scale of 0 from fitting a pane not measured yet
    return imageLength / 2;
  }
  return Math.min(Math.max(center, halfPane), imageLength - halfPane);
}

/**
 * Returns the image point a view shows in the middle of a pane, kept so the image fills it.
 *
 * @param view - The view.
 * @param image - The image's size.
 * @param pane - The pane's size.
 * @param scale - CSS pixels per image pixel.
 */
function centerOf(
  view: Viewport,
  image: ViewportSize,
  pane: ViewportSize,
  scale: number
) {
  const center =
    view.zoom === "fit"
      ? { x: image.width / 2, y: image.height / 2 }
      : view.center;

  return {
    x: clampAxis(center.x, image.width, pane.width, scale),
    y: clampAxis(center.y, image.height, pane.height, scale),
  };
}

/**
 * Works out where a pane draws the image for a view. Offsets are whole device pixels, so the
 * image's pixels line up with the display's at 100%, and it is pixelated above 100%.
 *
 * @param view - The view.
 * @param image - The image's size.
 * @param pane - The pane's size.
 * @param pixelRatio - The display's device pixels per CSS pixel.
 * @returns The image's position and size in the pane.
 */
function layoutOf(
  view: Viewport,
  image: ViewportSize,
  pane: ViewportSize,
  pixelRatio: number
): ViewportLayout {
  const zoom = zoomOf(view, image, pane, pixelRatio);
  const scale = zoom / pixelRatio;
  const center = centerOf(view, image, pane, scale);
  const snap = (cssPixels: number) =>
    Math.round(cssPixels * pixelRatio) / pixelRatio;

  return {
    left: snap(pane.width / 2 - center.x * scale),
    top: snap(pane.height / 2 - center.y * scale),
    width: image.width * scale,
    height: image.height * scale,
    zoom,
    pixelated: zoom > 1,
  };
}

/**
 * Moves a view by a drag in a pane. A fitted view shows the whole image, so it doesn't move.
 *
 * @param view - The view.
 * @param delta - How far the pointer moved, in CSS pixels.
 * @param image - The image's size.
 * @param pane - The pane dragged in.
 * @param pixelRatio - The display's device pixels per CSS pixel.
 */
function panBy(
  view: Viewport,
  delta: ViewportPoint,
  image: ViewportSize,
  pane: ViewportSize,
  pixelRatio: number
): Viewport {
  if (view.zoom === "fit") {
    return view;
  }

  const scale = view.zoom / pixelRatio;
  const center = centerOf(view, image, pane, scale);
  const panned = {
    zoom: view.zoom,
    center: { x: center.x - delta.x / scale, y: center.y - delta.y / scale },
  };

  return { zoom: view.zoom, center: centerOf(panned, image, pane, scale) };
}

/**
 * Sets a view's zoom, keeping the image point it shows in the middle of the panes: the image's
 * middle when it is fitted.
 *
 * @param view - The view.
 * @param zoom - The zoom, in device pixels per image pixel.
 * @param image - The image's size.
 */
function zoomTo(view: Viewport, zoom: number, image: ViewportSize): Viewport {
  const center =
    view.zoom === "fit"
      ? { x: image.width / 2, y: image.height / 2 }
      : view.center;

  return { zoom, center };
}

/**
 * Zooms a view, keeping the image point under an anchor where it is. It zooms out no further
 * than fit, or 100% for an image smaller than the pane, and in no further than 3200%. Zoomed
 * out as far as it goes to fit, it becomes a fitted view, which follows the pane's size.
 *
 * @param view - The view.
 * @param zoom - The zoom wanted, in device pixels per image pixel.
 * @param image - The image's size.
 * @param pane - The pane zoomed in.
 * @param pixelRatio - The display's device pixels per CSS pixel.
 * @param anchor - The pane point to zoom around, in CSS pixels; the pane's middle by default.
 */
function zoomAt(
  view: Viewport,
  zoom: number,
  image: ViewportSize,
  pane: ViewportSize,
  pixelRatio: number,
  anchor?: ViewportPoint
): Viewport {
  const fit = fitZoom(image, pane, pixelRatio);

  if (zoom <= fit && fit <= 1) {
    return FIT_VIEW;
  }

  const fromScale = zoomOf(view, image, pane, pixelRatio) / pixelRatio;
  const to = Math.min(Math.max(zoom, Math.min(fit, 1)), MAX_ZOOM);
  const toScale = to / pixelRatio;
  const center = centerOf(view, image, pane, fromScale);
  const offset = {
    x: (anchor?.x ?? pane.width / 2) - pane.width / 2,
    y: (anchor?.y ?? pane.height / 2) - pane.height / 2,
  };
  const anchored = {
    x: center.x + offset.x / fromScale - offset.x / toScale,
    y: center.y + offset.y / fromScale - offset.y / toScale,
  };

  return {
    zoom: to,
    center: centerOf({ zoom: to, center: anchored }, image, pane, toScale),
  };
}

/**
 * Returns how much a turn of the mouse wheel zooms by: in for a turn away from the person.
 *
 * @param deltaY - The wheel event's `deltaY`.
 * @param deltaMode - The wheel event's `deltaMode`: 0 for pixels, 1 for lines.
 */
function wheelZoomFactor(deltaY: number, deltaMode: number) {
  const pixels = deltaMode === 0 ? deltaY : deltaY * 40;

  return 2 ** (-pixels / 300); // a mouse's 100 px notch zooms by about a quarter
}

export {
  FIT_VIEW,
  ZOOM_PRESETS,
  fitZoom,
  layoutOf,
  panBy,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
  zoomOf,
};
export type { ViewportPoint, ViewportSize, Viewport, ViewportLayout };

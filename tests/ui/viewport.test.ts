import { describe, expect, it } from "vitest";
import {
  FIT_VIEW,
  fitZoom,
  layoutOf,
  panBy,
  wheelZoomFactor,
  zoomAt,
  zoomTo,
} from "../../ui/src/viewport.js";
import type {
  Viewport,
  ViewportLayout,
  ViewportPoint,
  ViewportSize,
} from "../../ui/src/viewport.js";

const PHOTO: ViewportSize = { width: 800, height: 600 };
const PANE: ViewportSize = { width: 400, height: 300 };

/**
 * Returns the image point a layout draws at a pane point.
 *
 * @param layout - The layout.
 * @param image - The image's size.
 * @param point - The pane point, in CSS pixels.
 */
function imagePointAt(
  layout: ViewportLayout,
  image: ViewportSize,
  point: ViewportPoint
) {
  return {
    x: ((point.x - layout.left) / layout.width) * image.width,
    y: ((point.y - layout.top) / layout.height) * image.height,
  };
}

/**
 * Returns a zoomed view's centre.
 *
 * @param view - The view.
 */
function centerOf(view: Viewport) {
  if (view.zoom === "fit") {
    throw new Error("the view should be zoomed");
  }
  return view.center;
}

describe("layoutOf", () => {
  it("fits the whole image in the pane, centred", () => {
    const layout = layoutOf(FIT_VIEW, PHOTO, { width: 400, height: 400 }, 1);

    expect(layout).toEqual({
      left: 0,
      top: 50,
      width: 400,
      height: 300,
      zoom: 0.5,
      pixelated: false,
    });
  });

  it("counts zoom in device pixels, so fit on a 2x display is 100%", () => {
    expect(layoutOf(FIT_VIEW, PHOTO, PANE, 2)).toMatchObject({
      width: 400,
      height: 300,
      zoom: 1,
    });
  });

  it("draws 100% as one image pixel per device pixel, at whole device pixels", () => {
    const pixelRatio = 1.25;
    const view: Viewport = { zoom: 1, center: { x: 333.3, y: 222.2 } };
    const layout = layoutOf(view, PHOTO, PANE, pixelRatio);

    expect(layout.width * pixelRatio).toBeCloseTo(800);
    expect(layout.height * pixelRatio).toBeCloseTo(600);
    expect(
      Number.isInteger(Math.round(layout.left * pixelRatio * 1e9) / 1e9)
    ).toBe(true);
    expect(
      Number.isInteger(Math.round(layout.top * pixelRatio * 1e9) / 1e9)
    ).toBe(true);
    expect(layout.pixelated).toBe(false);
  });

  it("pixelates only above 100%, including a small image fitted", () => {
    const at = (zoom: number) =>
      layoutOf({ zoom, center: { x: 400, y: 300 } }, PHOTO, PANE, 1);
    const icon = layoutOf(FIT_VIEW, { width: 8, height: 8 }, PANE, 1);

    expect(at(1).pixelated).toBe(false);
    expect(at(2).pixelated).toBe(true);
    expect(icon).toMatchObject({ zoom: 37.5, pixelated: true });
  });

  it("keeps the image filling the pane when the centre is near an edge", () => {
    const corner = layoutOf(
      { zoom: 4, center: { x: 0, y: 0 } },
      PHOTO,
      PANE,
      1
    );
    const farCorner = layoutOf(
      { zoom: 4, center: { x: 5000, y: 5000 } },
      PHOTO,
      PANE,
      1
    );

    expect(corner).toMatchObject({ left: 0, top: 0 });
    expect(farCorner.left + farCorner.width).toBe(PANE.width);
    expect(farCorner.top + farCorner.height).toBe(PANE.height);
  });

  it("centres an image smaller than the pane, wherever the view's centre is", () => {
    const layout = layoutOf(
      { zoom: 0.25, center: { x: 0, y: 0 } },
      PHOTO,
      PANE,
      1
    );

    expect(layout).toMatchObject({
      left: 100,
      top: 75,
      width: 200,
      height: 150,
    });
  });

  it("lays out a pane not measured yet without NaN", () => {
    const layout = layoutOf(FIT_VIEW, PHOTO, { width: 0, height: 0 }, 1);

    expect(Object.values(layout).every((value) => !Number.isNaN(value))).toBe(
      true
    );
  });

  it("shows panes of one size the same part of the image", () => {
    const view: Viewport = { zoom: 2, center: { x: 250, y: 410 } };
    const original = layoutOf(view, PHOTO, PANE, 1.5);
    const output = layoutOf(view, { ...PHOTO }, { ...PANE }, 1.5);

    expect(output).toEqual(original);
    expect(imagePointAt(original, PHOTO, { x: 200, y: 150 }).x).toBeCloseTo(
      250,
      0
    );
  });
});

describe("panBy", () => {
  it("moves the image with the pointer", () => {
    const view: Viewport = { zoom: 2, center: { x: 400, y: 300 } };

    expect(panBy(view, { x: 100, y: -40 }, PHOTO, PANE, 1)).toEqual({
      zoom: 2,
      center: { x: 350, y: 320 },
    });
  });

  it("scales the drag by the display's pixel ratio", () => {
    const view: Viewport = { zoom: 2, center: { x: 400, y: 300 } };

    expect(centerOf(panBy(view, { x: 100, y: 0 }, PHOTO, PANE, 2)).x).toBe(300);
  });

  it("stops at the image's edge, so dragging back moves it at once", () => {
    const view: Viewport = { zoom: 2, center: { x: 400, y: 300 } };
    const pastEdge = panBy(view, { x: 5000, y: 0 }, PHOTO, PANE, 1);
    const back = panBy(pastEdge, { x: -10, y: 0 }, PHOTO, PANE, 1);

    expect(centerOf(pastEdge).x).toBe(100);
    expect(centerOf(back).x).toBe(105);
  });

  it("leaves a fitted view alone", () => {
    expect(panBy(FIT_VIEW, { x: 50, y: 50 }, PHOTO, PANE, 1)).toBe(FIT_VIEW);
  });
});

describe("zoomAt", () => {
  it("keeps the image point under the pointer where it is", () => {
    const view: Viewport = { zoom: 1, center: { x: 400, y: 300 } };
    const pointer = { x: 300, y: 100 };
    const before = imagePointAt(layoutOf(view, PHOTO, PANE, 1), PHOTO, pointer);
    const zoomed = zoomAt(view, 3, PHOTO, PANE, 1, pointer);
    const after = imagePointAt(
      layoutOf(zoomed, PHOTO, PANE, 1),
      PHOTO,
      pointer
    );

    expect(zoomed.zoom).toBe(3);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it("zooms around the pane's middle without a pointer, from fit too", () => {
    const zoomed = zoomAt(FIT_VIEW, 2, PHOTO, PANE, 1);

    expect(zoomed).toEqual({ zoom: 2, center: { x: 400, y: 300 } });
  });

  it("zooms out no further than fit, then follows the pane as a fitted view", () => {
    const view: Viewport = { zoom: 1, center: { x: 400, y: 300 } };

    expect(zoomAt(view, 0.01, PHOTO, PANE, 1)).toBe(FIT_VIEW);
    expect(zoomAt(view, 0.6, PHOTO, PANE, 1).zoom).toBe(0.6);
  });

  it("zooms an image smaller than the pane out to 100% at most", () => {
    const icon = { width: 8, height: 8 };
    const view: Viewport = { zoom: 10, center: { x: 4, y: 4 } };

    expect(zoomAt(view, 0.1, icon, PANE, 1).zoom).toBe(1);
    expect(fitZoom(icon, PANE, 1)).toBe(37.5);
  });

  it("zooms in no further than 3200%", () => {
    expect(zoomAt(FIT_VIEW, 1000, PHOTO, PANE, 1).zoom).toBe(32);
  });
});

describe("zoomTo", () => {
  it("keeps the view's centre, or takes the image's middle from fit", () => {
    const view: Viewport = { zoom: 2, center: { x: 120, y: 80 } };

    expect(zoomTo(view, 4, PHOTO)).toEqual({ zoom: 4, center: view.center });
    expect(zoomTo(FIT_VIEW, 1, PHOTO)).toEqual({
      zoom: 1,
      center: { x: 400, y: 300 },
    });
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in for a turn away, out for a turn back, and counts lines as pixels", () => {
    expect(wheelZoomFactor(-100, 0)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0)).toBeLessThan(1);
    expect(wheelZoomFactor(100, 0) * wheelZoomFactor(-100, 0)).toBeCloseTo(1);
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(120, 0));
  });
});

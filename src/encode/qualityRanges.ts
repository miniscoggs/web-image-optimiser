// the qualities worth searching per lossy encoder: below the floor nothing passes a useful
// target, and above the ceiling files grow without a visible gain
const QUALITY_RANGES = {
  webp: [30, 95],
  avif: [20, 90],
  jpeg: [40, 95],
} as const satisfies Record<string, readonly [number, number]>;

export default QUALITY_RANGES;

// Renders the desktop app's OS icons from the outlines in desktop/resources/, in white on the
// app-blue tile, into desktop/build/icons/: icon.png, 1024 px on macOS's icon grid, which
// electron-builder turns into the .icns, and icon.ico, whose 16 and 24 px images use the
// simplified outline. `npm run package:desktop` runs it. Usage: node scripts/build-icons.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const RESOURCES = new URL("../desktop/resources/", import.meta.url);
const OUTPUT = new URL("../desktop/build/icons/", import.meta.url);
const APP_BLUE = "#2f6fdf";
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const FULL_FROM = 32; // the simplified outline below this size
const MAC_CANVAS = 1024;
const MAC_TILE = 824; // apple's grid leaves a margin round the tile

/**
 * Renders an outline in white at a size.
 *
 * @param {string} svg - The outline's SVG, drawn in `currentColor` on a 256-unit grid.
 * @param {number} size - Its size in pixels.
 */
function renderOutline(svg, size) {
  const white = Buffer.from(svg.replaceAll("currentColor", "#ffffff"));

  return sharp(white, { density: (72 * size) / 256 }) // 72 dpi renders the grid at 256 px
    .resize(size, size)
    .png()
    .toBuffer();
}

/**
 * Renders the icon: the outline on the app-blue tile, with the tile's corners and the outline in
 * the canvas design's proportions, 11 and 36 px of a 48 px tile.
 *
 * @param {string} svg - The outline's SVG.
 * @param {number} canvas - The image's size in pixels.
 * @param {number} tile - The tile's size, centred on the image.
 */
async function renderIcon(svg, canvas, tile) {
  const margin = (canvas - tile) / 2;
  const outlineSize = Math.round((tile * 36) / 48);
  const outlineAt = Math.round((canvas - outlineSize) / 2);
  const tileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}"><rect x="${margin}" y="${margin}" width="${tile}" height="${tile}" rx="${(tile * 11) / 48}" fill="${APP_BLUE}"/></svg>`;
  const outline = await renderOutline(svg, outlineSize);

  return sharp(Buffer.from(tileSvg))
    .composite([{ input: outline, left: outlineAt, top: outlineAt }])
    .png()
    .toBuffer();
}

/**
 * Returns an image as an ICO entry's data: a 32-bit bitmap, bottom-up in BGRA with an empty AND
 * mask, which every Windows icon reader takes, or the PNG itself at 256 px.
 *
 * @param {Buffer} png - The image.
 * @param {number} size - Its size in pixels.
 */
async function icoImage(png, size) {
  if (size === 256) {
    return png;
  }

  const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
  const maskRow = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  const pixels = Buffer.alloc(size * size * 4);

  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // the pixels and the mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const from = (row * size + column) * 4;
      const to = ((size - 1 - row) * size + column) * 4;

      pixels[to] = rgba[from + 2];
      pixels[to + 1] = rgba[from + 1];
      pixels[to + 2] = rgba[from];
      pixels[to + 3] = rgba[from + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]);
}

/**
 * Packs images into an ICO file.
 *
 * @param {{ size: number, data: Buffer }[]} images - Each image's size and entry data.
 */
function packIco(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  let offset = header.length;

  header.writeUInt16LE(1, 2); // an icon, not a cursor
  header.writeUInt16LE(images.length, 4);
  for (const [index, { size, data }] of images.entries()) {
    const entry = 6 + 16 * index;

    header.writeUInt8(size % 256, entry); // 0 means 256
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  }
  return Buffer.concat([header, ...images.map(({ data }) => data)]);
}

const full = await readFile(new URL("icon.svg", RESOURCES), "utf8");
const simplified = await readFile(new URL("icon-small.svg", RESOURCES), "utf8");
const icoImages = [];

for (const size of ICO_SIZES) {
  const png = await renderIcon(
    size < FULL_FROM ? simplified : full,
    size,
    size
  );

  icoImages.push({ size, data: await icoImage(png, size) });
}
await mkdir(OUTPUT, { recursive: true });
await writeFile(
  new URL("icon.png", OUTPUT),
  await renderIcon(full, MAC_CANVAS, MAC_TILE)
);
await writeFile(new URL("icon.ico", OUTPUT), packIco(icoImages));
console.log(`Wrote icon.png and icon.ico to ${fileURLToPath(OUTPUT)}`);

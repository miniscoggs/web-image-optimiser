// Builds the synthetic fixtures and manifest.json. `--photos` also re-derives the photos from their sources.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { format, resolveConfig } from "prettier";
import sharp from "sharp";

const FIXTURE_DIR = new URL("./", import.meta.url);
const USER_AGENT =
  "web-image-optimiser-fixtures (https://github.com/miniscoggs/web-image-optimiser)";
const PHOTO_LONG_EDGE = 1600;

const GENERATED = { source: "fixtures/generate.mjs", licence: "MIT" };
const HAND_WRITTEN = { source: "hand-written", licence: "MIT" };
const TRAIT_DEFAULTS = {
  alpha: false,
  animated: false,
  bitDepth: 8,
  orientation: 1,
  icc: null,
  metadata: [],
};

const BASIC_EXIF = {
  IFD0: {
    Make: "Fixture Camera Co",
    Model: "FX-1",
    Software: "fixtures/generate.mjs",
  },
};
const EXIF_WITH_GPS = {
  ...BASIC_EXIF,
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "51/1 28/1 40/1",
    GPSLongitudeRef: "W",
    GPSLongitude: "0/1 0/1 5/1",
  },
};
const XMP_PACKET = [
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
  "<dc:creator><rdf:Seq><rdf:li>Fixture Author</rdf:li></rdf:Seq></dc:creator>",
  "<xmp:CreatorTool>fixtures/generate.mjs</xmp:CreatorTool>",
  "</rdf:Description>",
  "</rdf:RDF>",
  "</x:xmpmeta>",
  '<?xpacket end="w"?>',
].join("");

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160">
  <rect x="16" y="16" width="128" height="128" rx="28" fill="#2563eb"/>
  <path d="M40 104 L60 48 L80 88 L100 48 L120 104" fill="none" stroke="#ffffff" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="200" cy="80" r="40" fill="#f59e0b"/>
  <polygon points="256,120 300,40 300,120" fill="#10b981"/>
</svg>`;

const ICON_PALETTE = {
  ".": [0, 0, 0, 0],
  "#": [30, 41, 59, 255],
  o: [249, 115, 22, 255],
};
const ICON_ROWS = ["..##..", ".#oo#.", "#oooo#", "#oooo#", ".#oo#.", "..##.."];

const P3_PATCHES = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [0, 255, 255],
  [255, 0, 255],
  [255, 255, 0],
];

/**
 * Returns a seeded mulberry32 generator, so grain is identical on every platform.
 *
 * @param seed - Initial state.
 */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a sharp pipeline from pixels computed per coordinate.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param channels - 3 for RGB, 4 for RGBA.
 * @param colourAt - Returns the channel values for pixel (x, y).
 * @param deep - Whether samples are 16-bit rather than 8-bit.
 */
function renderPixels(width, height, channels, colourAt, deep = false) {
  const pixels = deep
    ? new Uint16Array(width * height * channels)
    : new Uint8ClampedArray(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set(colourAt(x, y), (y * width + x) * channels);
    }
  }
  const depth = deep ? "ushort" : "uchar";
  return sharp(Buffer.from(pixels.buffer), {
    raw: { width, height, channels, depth },
  });
}

/**
 * Renders a photo-like RGB scene: sky gradient, sun, rolling hills and grain, with a red
 * marker in the top-left corner so orientation mistakes are visible.
 *
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param seed - Seed for the grain.
 */
function renderScene(width, height, seed) {
  const random = createRandom(seed);
  const sunRadius = Math.min(width, height) * 0.12;
  return renderPixels(width, height, 3, (x, y) => {
    const horizon =
      height * (0.62 + 0.06 * Math.sin((x / width) * Math.PI * 3));
    const grain = (random() - 0.5) * 20;
    let colour;
    if (x < width / 8 && y < height / 8) {
      colour = [210, 40, 40];
    } else if (y > horizon) {
      const shade = 0.75 + 0.25 * Math.sin(x * 0.045) * Math.cos(y * 0.06);
      colour = [70 * shade, 125 * shade, 55 * shade];
    } else if (Math.hypot(x - width * 0.7, y - height * 0.3) < sunRadius) {
      colour = [255, 225, 140];
    } else {
      const skyMix = y / horizon;
      colour = [95 + 110 * skyMix, 150 + 60 * skyMix, 235 - 35 * skyMix];
    }
    return colour.map((value) => value + grain);
  });
}

/**
 * Builds an SVG of an app settings screen, for a text-heavy "screenshot" fixture.
 */
function buildScreenshotSvg() {
  const font = 'font-family="Arial, Helvetica, sans-serif"';
  const navigation = ["Overview", "Images", "Settings", "Help"]
    .map(
      (label, index) =>
        `<text x="24" y="${92 + index * 36}" ${font} font-size="15" fill="#0f172a">${label}</text>`
    )
    .join("");
  const paragraph = [
    "Images are written at the smallest size that stays above the quality target.",
    "Metadata such as GPS location and camera details is removed from every output.",
    "Choose a stricter target when images are shown full screen or inspected closely.",
  ]
    .map(
      (line, index) =>
        `<text x="232" y="${140 + index * 24}" ${font} font-size="14" fill="#334155">${line}</text>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500">
  <rect width="800" height="500" fill="#f8fafc"/>
  <rect width="800" height="40" fill="#1e293b"/>
  <circle cx="20" cy="20" r="6" fill="#ef4444"/>
  <circle cx="40" cy="20" r="6" fill="#f59e0b"/>
  <circle cx="60" cy="20" r="6" fill="#22c55e"/>
  <text x="400" y="26" ${font} font-size="14" fill="#e2e8f0" text-anchor="middle">Image Optimiser - Settings</text>
  <rect y="40" width="200" height="460" fill="#e2e8f0"/>
  <rect x="12" y="142" width="176" height="30" rx="6" fill="#cbd5e1"/>
  ${navigation}
  <text x="232" y="100" ${font} font-size="24" font-weight="bold" fill="#0f172a">Image settings</text>
  ${paragraph}
  <text x="232" y="250" ${font} font-size="13" fill="#475569">Quality target</text>
  <rect x="232" y="260" width="320" height="36" rx="6" fill="#ffffff" stroke="#94a3b8"/>
  <text x="246" y="283" ${font} font-size="14" fill="#0f172a">high (SSIMULACRA 2 score 80)</text>
  <rect x="232" y="320" width="140" height="40" rx="8" fill="#2563eb"/>
  <text x="302" y="345" ${font} font-size="14" fill="#ffffff" text-anchor="middle">Save changes</text>
</svg>`;
}

/**
 * Builds one JPEG marker segment.
 *
 * @param marker - Marker byte, eg 0xfe for COM.
 * @param data - Segment payload.
 */
function jpegSegment(marker, data) {
  const header = Buffer.from([0xff, marker, 0, 0]);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

/**
 * Splits a JPEG into its leading APPn/COM segments and everything after them.
 *
 * @param jpeg - JPEG bytes.
 */
function splitJpegHeader(jpeg) {
  const segments = [];
  let offset = 2; // after SOI
  while (isHeaderMarker(jpeg[offset + 1])) {
    const end = offset + 2 + jpeg.readUInt16BE(offset + 2);
    segments.push(jpeg.subarray(offset, end));
    offset = end;
  }
  return { segments, body: jpeg.subarray(offset) };
}

/**
 * Returns whether a JPEG marker is an APPn or COM segment.
 *
 * @param marker - Marker byte.
 */
function isHeaderMarker(marker) {
  return (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
}

/**
 * Reassembles a JPEG from header segments and a body.
 *
 * @param segments - APPn/COM segments, in order.
 * @param body - Bytes from the first non-header marker onwards.
 */
function joinJpeg(segments, body) {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, body]);
}

/**
 * Builds one PNG chunk, including its CRC.
 *
 * @param type - Four-letter chunk type.
 * @param data - Chunk payload.
 */
function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const chunk = Buffer.alloc(typeAndData.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), chunk.length - 4);
  return chunk;
}

/**
 * Builds a PNG tEXt chunk.
 *
 * @param keyword - Latin-1 keyword, eg "Author".
 * @param text - Latin-1 text.
 */
function pngTextChunk(keyword, text) {
  return pngChunk("tEXt", Buffer.from(`${keyword}\0${text}`, "latin1"));
}

/**
 * Inserts chunks directly after a PNG's IHDR chunk.
 *
 * @param png - PNG bytes.
 * @param chunks - Complete chunks to insert.
 */
function insertAfterIhdr(png, chunks) {
  const ihdrEnd = 8 + 12 + png.readUInt32BE(8); // signature, then IHDR's length, type, data and CRC
  return Buffer.concat([
    png.subarray(0, ihdrEnd),
    ...chunks,
    png.subarray(ihdrEnd),
  ]);
}

/**
 * Builds a JPEG of saturated patches whose pixels are encoded directly in Display P3.
 */
async function buildDisplayP3() {
  const patchWidth = 400 / 3;
  const plain = await renderPixels(400, 300, 3, (x, y) => {
    const patch = P3_PATCHES[Math.floor(x / patchWidth) + (y < 150 ? 0 : 3)];
    const fade = (y % 150) / 150;
    return patch.map((value) => value + (255 - value) * fade * 0.5);
  })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const tagged = await renderPixels(8, 8, 3, () => [0, 0, 0])
    .withIccProfile("p3") // throwaway image, as tagging the patches directly would convert them to P3
    .jpeg()
    .toBuffer();
  const iccSegments = splitJpegHeader(tagged).segments.filter(
    (segment) =>
      segment[1] === 0xe2 &&
      segment.toString("latin1", 4, 16) === "ICC_PROFILE\0"
  );
  const { segments, body } = splitJpegHeader(plain);
  return joinJpeg([...segments, ...iccSegments], body);
}

/**
 * Builds a three-frame animated WebP of a ball moving across the frame.
 */
async function buildAnimatedWebp() {
  const frames = await Promise.all(
    [0, 1, 2].map((index) =>
      renderPixels(64, 64, 3, (x, y) =>
        Math.hypot(x - (16 + 16 * index), y - 32) < 10
          ? [239, 68, 68]
          : [241, 245, 249]
      )
        .png()
        .toBuffer()
    )
  );
  return sharp(frames, { join: { animated: true } })
    .webp({ loop: 0, delay: [120, 120, 120] })
    .toBuffer();
}

/**
 * Downloads a photo, checks its hash, and resizes it while keeping its original APPn/COM
 * segments byte for byte.
 *
 * @param photo - The photo's source description.
 */
async function buildPhoto(photo) {
  const response = await fetch(photo.url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`${photo.url}: HTTP ${response.status}`);
  }
  const original = Buffer.from(await response.arrayBuffer());
  const sha1 = createHash("sha1").update(original).digest("hex");
  if (sha1 !== photo.sha1) {
    throw new Error(`${photo.url}: expected sha1 ${photo.sha1}, got ${sha1}`);
  }
  const resized = await sharp(original)
    .resize({ width: PHOTO_LONG_EDGE, height: PHOTO_LONG_EDGE, fit: "inside" })
    .keepIccProfile()
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const originalHeader = splitJpegHeader(original);
  const resizedBody = splitJpegHeader(resized).body;
  return joinJpeg(originalHeader.segments, resizedBody); // assumes any APP14 says YCbCr (transform=1), as mozjpeg writes
}

const FIXTURES = [
  {
    file: "gradient.png",
    traits: { kind: "gradient", format: "png", width: 512, height: 384 },
    build: () =>
      renderPixels(512, 384, 3, (x, y) => [
        (255 * x) / 511,
        (255 * y) / 383,
        255 - (255 * x) / 511,
      ])
        .png()
        .toBuffer(),
  },
  {
    file: "gradient-16bit.png",
    traits: {
      kind: "gradient",
      format: "png",
      width: 256,
      height: 192,
      bitDepth: 16,
    },
    build: () =>
      renderPixels(
        256,
        192,
        3,
        (x, y) => [
          Math.round((65535 * x) / 255),
          Math.round((65535 * y) / 191),
          32768,
        ],
        true
      )
        .toColourspace("rgb16")
        .png()
        .toBuffer(),
  },
  {
    file: "screenshot.png",
    traits: { kind: "screenshot", format: "png", width: 800, height: 500 },
    build: () =>
      sharp(Buffer.from(buildScreenshotSvg())).removeAlpha().png().toBuffer(),
  },
  {
    file: "logo-alpha.png",
    traits: {
      kind: "logo",
      format: "png",
      width: 320,
      height: 160,
      alpha: true,
    },
    build: () => sharp(Buffer.from(LOGO_SVG)).png().toBuffer(),
  },
  {
    file: "semi-transparent.png",
    traits: {
      kind: "graphic",
      format: "png",
      width: 256,
      height: 256,
      alpha: true,
    },
    build: () =>
      renderPixels(256, 256, 4, (x, y) => {
        const distance = Math.hypot(x - 128, y - 128) / 128;
        return [
          255,
          140 + (80 * (x - 128)) / 128,
          60 + (60 * (y - 128)) / 128,
          255 * (1 - distance),
        ];
      })
        .png()
        .toBuffer(),
  },
  {
    file: "icon-6x6.png",
    traits: { kind: "icon", format: "png", width: 6, height: 6, alpha: true },
    build: () =>
      renderPixels(6, 6, 4, (x, y) => ICON_PALETTE[ICON_ROWS[y][x]])
        .png()
        .toBuffer(),
  },
  {
    file: "text-chunks.png",
    traits: {
      kind: "scene",
      format: "png",
      width: 320,
      height: 240,
      metadata: ["exif", "text"],
    },
    build: async () => {
      const png = await renderScene(320, 240, 3)
        .withExif(BASIC_EXIF)
        .png()
        .toBuffer();
      return insertAfterIhdr(png, [
        pngTextChunk("Author", "Fixture Author"),
        pngTextChunk("Description", "Synthetic scene with text chunks"),
        pngTextChunk("Software", "fixtures/generate.mjs"),
      ]);
    },
  },
  {
    file: "orientation-6.jpg",
    traits: {
      kind: "scene",
      format: "jpeg",
      width: 320,
      height: 480,
      orientation: 6,
      icc: "srgb",
      metadata: ["comment", "exif", "gps", "xmp"],
    },
    notes:
      'Stored 480x320 with the marker top-left; displays rotated 90 degrees clockwise. Carries libvips\'s compact v4 profile, described as just "sRGB".',
    build: async () => {
      const jpeg = await renderScene(480, 320, 1)
        .withExif(EXIF_WITH_GPS)
        .withMetadata({ orientation: 6 })
        .withXmp(XMP_PACKET)
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
      const { segments, body } = splitJpegHeader(jpeg);
      const comment = jpegSegment(
        0xfe,
        Buffer.from("Generated by fixtures/generate.mjs", "latin1")
      );
      return joinJpeg([...segments, comment], body);
    },
  },
  {
    file: "display-p3.jpg",
    traits: {
      kind: "graphic",
      format: "jpeg",
      width: 400,
      height: 300,
      icc: "non-srgb",
    },
    notes:
      'Pixels are Display P3 values, not converted from sRGB. The profile is described as "sP3C".',
    build: buildDisplayP3,
  },
  {
    file: "lossy.webp",
    traits: {
      kind: "scene",
      format: "webp",
      width: 480,
      height: 320,
      metadata: ["exif", "xmp"],
    },
    build: () =>
      renderScene(480, 320, 2)
        .withExif(BASIC_EXIF)
        .withXmp(XMP_PACKET)
        .webp({ quality: 80 })
        .toBuffer(),
  },
  {
    file: "lossless.webp",
    traits: {
      kind: "logo",
      format: "webp",
      width: 320,
      height: 160,
      metadata: ["exif", "xmp"],
    },
    build: () =>
      sharp(Buffer.from(LOGO_SVG))
        .flatten({ background: "#ffffff" })
        .withExif(BASIC_EXIF)
        .withXmp(XMP_PACKET)
        .webp({ lossless: true })
        .toBuffer(),
  },
  {
    file: "animated.webp",
    traits: {
      kind: "animation",
      format: "webp",
      width: 64,
      height: 64,
      alpha: true,
      animated: true,
    },
    notes: "Three frames; width and height are per frame.",
    build: buildAnimatedWebp,
  },
  {
    file: "exif.avif",
    traits: {
      kind: "scene",
      format: "avif",
      width: 480,
      height: 320,
      metadata: ["exif"],
    },
    build: () =>
      renderScene(480, 320, 4)
        .withExif(BASIC_EXIF)
        .avif({ quality: 60, effort: 4 })
        .toBuffer(),
  },
  {
    file: "editor-metadata.svg",
    origin: HAND_WRITTEN,
    traits: {
      kind: "illustration",
      format: "svg",
      width: 240,
      height: 160,
      alpha: true,
      metadata: ["comment", "editor"],
      svg: { viewBox: true, title: false, referencedIds: [] },
    },
    notes: "Inkscape namespaces, RDF metadata, comments and long decimals.",
  },
  {
    file: "use-and-css-ids.svg",
    origin: HAND_WRITTEN,
    traits: {
      kind: "logo",
      format: "svg",
      width: 200,
      height: 120,
      alpha: true,
      svg: {
        viewBox: true,
        title: false,
        referencedIds: ["badge", "shine", "star", "star-1"],
      },
    },
    notes: "IDs used by <use href>, <use xlink:href>, url() and CSS selectors.",
  },
  {
    file: "title-viewbox.svg",
    origin: HAND_WRITTEN,
    traits: {
      kind: "icon",
      format: "svg",
      width: 64,
      height: 64,
      alpha: true,
      svg: { viewBox: true, title: true, referencedIds: ["desc", "title"] },
    },
    notes:
      "viewBox only, no width or height; <title> and <desc> referenced by aria-labelledby.",
  },
  {
    file: "photo-butterfly.jpg",
    traits: {
      kind: "photo",
      format: "jpeg",
      width: 1600,
      height: 1085,
      icc: "srgb",
      metadata: ["exif", "gps", "iptc", "xmp"],
    },
    notes:
      "Macro with bokeh. Has an APP14 Adobe segment and no Orientation tag.",
    photo: {
      url: "https://upload.wikimedia.org/wikipedia/commons/4/4f/Chlosyne_lacinia.jpg",
      page: "https://commons.wikimedia.org/wiki/File:Chlosyne_lacinia.jpg",
      author: "Wilfredor",
      sha1: "a221b3bdbd2cf81b5fe9bff34577e98fe905288d",
    },
  },
  {
    file: "photo-night-bridge.jpg",
    traits: {
      kind: "photo",
      format: "jpeg",
      width: 1600,
      height: 894,
      icc: "srgb",
      metadata: ["exif", "gps", "iptc", "xmp"],
    },
    notes:
      "Night scene with point lights and noise. Has an APP14 Adobe segment.",
    photo: {
      url: "https://upload.wikimedia.org/wikipedia/commons/f/fd/Sz%C3%A9chenyi_Chain_Bridge_in_Budapest_at_night.jpg",
      page: "https://commons.wikimedia.org/wiki/File:Sz%C3%A9chenyi_Chain_Bridge_in_Budapest_at_night.jpg",
      author: "Wilfredor",
      sha1: "652aa31116969eb1caf99a252cba28f2192c09f1",
    },
  },
  {
    file: "photo-rhino.jpg",
    traits: {
      kind: "photo",
      format: "jpeg",
      width: 1600,
      height: 1187,
      icc: "non-srgb",
      metadata: ["comment", "exif"],
    },
    notes:
      "Museum specimen with fine texture. Adobe RGB (1998) profile and a COM segment.",
    photo: {
      url: "https://upload.wikimedia.org/wikipedia/commons/f/fa/Diceros_bicornis_MNHN.jpg",
      page: "https://commons.wikimedia.org/wiki/File:Diceros_bicornis_MNHN.jpg",
      author: "Jebulon",
      sha1: "5796b4d7ba39ed0b337915b5f3262af261ef1b88",
    },
  },
  {
    file: "photo-sunset.jpg",
    traits: {
      kind: "photo",
      format: "jpeg",
      width: 1600,
      height: 912,
      icc: "srgb",
      metadata: ["exif", "iptc", "xmp"],
    },
    notes:
      'Smooth sky gradients. Its sRGB profile is named "sRGB IEC61966-2-1 black scaled".',
    photo: {
      url: "https://upload.wikimedia.org/wikipedia/commons/3/3f/Juan_Griego_Sunset.jpg",
      page: "https://commons.wikimedia.org/wiki/File:Juan_Griego_Sunset.jpg",
      author: "Wilfredor",
      sha1: "31e75119e15518b56ee9658bb629a4e4d0c3e174",
    },
  },
];

/**
 * Returns a fixture's manifest entry.
 *
 * @param fixture - An entry from FIXTURES.
 */
function manifestEntry(fixture) {
  const origin = fixture.photo
    ? {
        source: fixture.photo.page,
        author: fixture.photo.author,
        licence: "CC0-1.0",
        derivation: `Resized to ${PHOTO_LONG_EDGE} px on the long edge (mozjpeg q90) with the original APPn/COM segments kept byte for byte.`,
      }
    : (fixture.origin ?? GENERATED);
  const { kind, format, width, height } = fixture.traits;
  return {
    file: fixture.file,
    kind,
    format,
    width,
    height,
    ...TRAIT_DEFAULTS,
    ...fixture.traits,
    ...(fixture.notes ? { notes: fixture.notes } : {}),
    ...origin,
  };
}

const includePhotos = process.argv.includes("--photos");
for (const fixture of FIXTURES) {
  const build =
    fixture.build ??
    (includePhotos && fixture.photo ? () => buildPhoto(fixture.photo) : null);
  if (build) {
    await writeFile(new URL(fixture.file, FIXTURE_DIR), await build());
  }
}
const manifestFile = new URL("manifest.json", FIXTURE_DIR);
const prettierConfig = await resolveConfig(manifestFile);
const manifest = await format(
  JSON.stringify({ fixtures: FIXTURES.map(manifestEntry) }),
  { ...prettierConfig, parser: "json" }
);
await writeFile(manifestFile, manifest);

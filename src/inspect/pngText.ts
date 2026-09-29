import { inflateSync } from "node:zlib";

type PngText = {
  keyword: string;
  /** The text's bytes, inflated when the chunk compressed them. */
  text: Buffer;
  /** Whether the text is UTF-8, as in `iTXt`, rather than Latin-1. */
  utf8: boolean;
};

const PNG_TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);
const PNG_XMP_KEYWORD = "XML:com.adobe.xmp";
const MAX_TEXT_LENGTH = 16 * 1024 * 1024; // guards against a compression bomb

/**
 * Returns the keyword a text chunk starts with.
 *
 * @param data - The chunk's data.
 */
function readPngKeyword(data: Buffer) {
  const end = data.indexOf(0);

  return data.toString("latin1", 0, end === -1 ? data.length : end);
}

/**
 * Reads a `tEXt`, `zTXt` or `iTXt` chunk's keyword and text.
 *
 * @param type - The chunk's type.
 * @param data - The chunk's data.
 * @returns `undefined` when the chunk is malformed or its text can't be inflated.
 */
function readPngText(type: string, data: Buffer): PngText | undefined {
  const keywordEnd = data.indexOf(0);

  if (keywordEnd === -1) {
    return undefined;
  }

  const keyword = data.toString("latin1", 0, keywordEnd);
  let compressed = type === "zTXt";
  let textStart = keywordEnd + (compressed ? 2 : 1); // zTXt has a compression method byte

  if (type === "iTXt") {
    const languageEnd = data.indexOf(0, keywordEnd + 3); // after the compression flag and method
    const translatedEnd = data.indexOf(0, languageEnd + 1);

    if (languageEnd === -1 || translatedEnd === -1) {
      return undefined;
    }
    compressed = data.readUInt8(keywordEnd + 1) === 1;
    textStart = translatedEnd + 1;
  }

  const stored = data.subarray(textStart);

  try {
    const text = compressed
      ? inflateSync(stored, { maxOutputLength: MAX_TEXT_LENGTH })
      : stored;

    return { keyword, text, utf8: type === "iTXt" };
  } catch {
    return undefined;
  }
}

export { PNG_TEXT_CHUNKS, PNG_XMP_KEYWORD, readPngKeyword, readPngText };

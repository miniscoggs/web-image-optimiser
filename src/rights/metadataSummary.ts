// imports nothing, so a browser bundle can import it as a value

/**
 * What an output keeps and removes of its input's metadata, in a few words each, as `wio --help`
 * says it. `kept` and `removed` cover raster images, and `svg` finishes the sentence "SVGs ...".
 */
const METADATA_SUMMARY = {
  kept: "Creator, Credit Line, Copyright Notice, Web Statement of Rights, Licensor URL and Digital Source Type, which Google Images reads for credits, licensing and AI labels. A file that is only stripped also keeps its orientation and a non-sRGB colour profile.",
  removed:
    "everything else: EXIF camera data, GPS location, captions, keywords, comments, text chunks, editor data and C2PA Content Credentials.",
  svg: "keep <title>, <desc> and <!--! licence --> comments, and lose <metadata>.",
} as const;

export default METADATA_SUMMARY;

const IMAGE_LICENCE_FIELDS = [
  "creator",
  "credit",
  "copyright",
  "webStatement",
  "licensorUrl",
] as const; // the five Google Images reads for credits and its Licensable badge
const IMAGE_RIGHTS_FIELDS = [
  ...IMAGE_LICENCE_FIELDS,
  "digitalSourceType",
] as const;
const DEFAULT_LANGUAGE = "x-default"; // a Copyright Notice's alternative for any language
// eslint-disable-next-line no-control-regex -- characters xml 1.0 can't hold, even escaped
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/**
 * The copyright, licence and AI-origin fields an image carries: the five Google Images reads for
 * credits and its Licensable badge, and Digital Source Type, which it reads to label
 * AI-generated images. A field the image lacks is left out, and no value or list is empty.
 */
type ImageRights = {
  /** Creator (`dc:creator`), in order. */
  creator?: string[];
  /** Credit Line (`photoshop:Credit`). */
  credit?: string;
  /** Copyright Notice (`dc:rights`), every language alternative, `x-default` first. */
  copyright?: { lang: string; value: string }[];
  /** Web Statement of Rights (`xmpRights:WebStatement`), the URL of the licence. */
  webStatement?: string;
  /** Licensor URL (`plus:LicensorURL`), where to license the image. */
  licensorUrl?: string[];
  /** Digital Source Type (`Iptc4xmpExt:DigitalSourceType`), a URI from IPTC's codes. */
  digitalSourceType?: string;
};

/**
 * One of the fields in {@link ImageRights}.
 */
type ImageRightsField = (typeof IMAGE_RIGHTS_FIELDS)[number];

/**
 * Each field's name as IPTC and Google Images write it.
 */
const IMAGE_RIGHTS_FIELD_NAMES = {
  creator: "Creator",
  credit: "Credit Line",
  copyright: "Copyright Notice",
  webStatement: "Web Statement of Rights",
  licensorUrl: "Licensor URL",
  digitalSourceType: "Digital Source Type",
} as const satisfies Record<ImageRightsField, string>;

export {
  DEFAULT_LANGUAGE,
  IMAGE_LICENCE_FIELDS,
  IMAGE_RIGHTS_FIELDS,
  IMAGE_RIGHTS_FIELD_NAMES,
  NOT_XML,
};
export type { ImageRights, ImageRightsField };

import { IMAGE_RIGHTS_FIELDS, NOT_XML } from "./types.js";
import type { ImageRights } from "./types.js";
import XMP_NAMESPACES from "./xmpNamespaces.js";

const FIELD_PREFIXES = {
  creator: "dc",
  credit: "photoshop",
  copyright: "dc",
  webStatement: "xmpRights",
  licensorUrl: "plus",
  digitalSourceType: "Iptc4xmpExt",
} satisfies Record<keyof ImageRights, keyof typeof XMP_NAMESPACES>;
const PACKET_START = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="${XMP_NAMESPACES.x}"><rdf:RDF xmlns:rdf="${XMP_NAMESPACES.rdf}">`;
const PACKET_END = '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\t": "&#9;", // a parser turns these into spaces in an attribute, and a CR into LF anywhere
  "\n": "&#10;",
  "\r": "&#13;",
};

/**
 * Escapes text for an XML attribute or element, dropping the characters XML can't hold.
 *
 * @param value - The text.
 */
function escapeXml(value: string) {
  return value
    .replace(NOT_XML, "")
    .replace(/[&<>"\t\n\r]/g, (character) => ESCAPES[character] ?? character);
}

/**
 * Returns a simple property as an attribute of `rdf:Description`.
 *
 * @param name - The property's qualified name.
 * @param value - Its value, if the rights have it.
 */
function toAttribute(name: string, value: string | undefined) {
  return value === undefined ? "" : ` ${name}="${escapeXml(value)}"`;
}

/**
 * Returns an array property as an element.
 *
 * @param name - The property's qualified name.
 * @param container - The RDF container: `Seq`, `Alt` or `Bag`.
 * @param items - Its `rdf:li` elements, if the rights have it.
 */
function toArray(name: string, container: string, items: string[] | undefined) {
  return items === undefined
    ? ""
    : `<${name}><rdf:${container}>${items.join("")}</rdf:${container}></${name}>`;
}

/**
 * Builds the smallest valid XMP packet holding the rights: the `xpacket` wrapper with no
 * padding, and one `rdf:Description` with the simple fields as attributes and the arrays as
 * elements. Values are escaped, dropping any character XML can't hold.
 *
 * @param rights - The fields to write.
 * @returns The packet as UTF-8, or `undefined` when the rights have no fields.
 */
function buildRightsPacket(rights: ImageRights) {
  const present = IMAGE_RIGHTS_FIELDS.filter(
    (field) => rights[field] !== undefined
  );
  const prefixes = new Set(present.map((field) => FIELD_PREFIXES[field]));

  if (prefixes.size === 0) {
    return undefined;
  }

  const declarations = [...prefixes]
    .map((prefix) => ` xmlns:${prefix}="${XMP_NAMESPACES[prefix]}"`)
    .join("");
  const attributes = [
    toAttribute("photoshop:Credit", rights.credit),
    toAttribute("xmpRights:WebStatement", rights.webStatement),
    toAttribute("Iptc4xmpExt:DigitalSourceType", rights.digitalSourceType),
  ].join("");
  const elements = [
    toArray(
      "dc:creator",
      "Seq",
      rights.creator?.map((name) => `<rdf:li>${escapeXml(name)}</rdf:li>`)
    ),
    toArray(
      "dc:rights",
      "Alt",
      rights.copyright?.map(
        ({ lang, value }) =>
          `<rdf:li xml:lang="${escapeXml(lang)}">${escapeXml(value)}</rdf:li>`
      )
    ),
    toArray(
      "plus:Licensor",
      "Bag",
      rights.licensorUrl?.map(
        (url) =>
          `<rdf:li rdf:parseType="Resource"><plus:LicensorURL>${escapeXml(url)}</plus:LicensorURL></rdf:li>`
      )
    ),
  ].join("");
  const description = `<rdf:Description rdf:about=""${declarations}${attributes}${elements === "" ? "/>" : `>${elements}</rdf:Description>`}`;

  return Buffer.from(PACKET_START + description + PACKET_END);
}

export default buildRightsPacket;

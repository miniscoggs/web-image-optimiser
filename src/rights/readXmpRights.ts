import sax from "sax";
import type { QualifiedTag } from "sax";
import { DEFAULT_LANGUAGE } from "./types.js";
import type { ImageRights } from "./types.js";
import XMP_NAMESPACES from "./xmpNamespaces.js";

type XmpName = { uri: string; local: string };

type XmpNode = XmpName & {
  attributes: (XmpName & { value: string })[];
  children: XmpNode[];
  text: string;
};

/** A property's value: an attribute's text, or the property's element. */
type XmpValue = string | XmpNode;

const { dc, photoshop, plus, rdf, xml, xmpRights, Iptc4xmpExt } =
  XMP_NAMESPACES;
const RDF_CONTAINERS = new Set(["Seq", "Bag", "Alt"]);
const PACKET_EDGES = /^\uFEFF|\0+$/g; // a leading byte order mark, and padding a writer left

/**
 * Parses an XMP packet into a tree of elements, each name resolved to its namespace URI.
 *
 * @param xmp - The packet, as UTF-8.
 * @throws Error when the packet isn't well-formed XML.
 */
function parseXmp(xmp: Buffer) {
  const parser = sax.parser(true, { xmlns: true });
  const root: XmpNode = {
    uri: "",
    local: "",
    attributes: [],
    children: [],
    text: "",
  };
  const open = [root];
  const current = () => open.at(-1) ?? root;
  const addText = (text: string) => {
    current().text += text;
  };

  parser.onopentag = (tag) => {
    const { uri, local, attributes } = tag as QualifiedTag;
    const node = {
      uri,
      local,
      attributes: Object.values(attributes),
      children: [],
      text: "",
    };

    current().children.push(node);
    open.push(node);
  };
  parser.onclosetag = () => {
    open.pop();
  };
  parser.ontext = addText;
  parser.oncdata = addText;
  parser.onerror = (error) => {
    throw error;
  };
  parser.write(xmp.toString("utf8").replace(PACKET_EDGES, "")).close();
  return root;
}

/**
 * Returns whether a node is an RDF element.
 *
 * @param node - The node.
 * @param local - The element's local name, eg `Description`.
 */
function isRdf(node: XmpNode, local: string) {
  return node.uri === rdf && node.local === local;
}

/**
 * Returns the `rdf:Description` elements of every `rdf:RDF` in a tree.
 *
 * @param node - The tree's root.
 */
function findDescriptions(node: XmpNode): XmpNode[] {
  return isRdf(node, "RDF")
    ? node.children.filter((child) => isRdf(child, "Description"))
    : node.children.flatMap(findDescriptions);
}

/**
 * Returns the `rdf:Description` elements of an XMP packet.
 *
 * @param xmp - The packet.
 * @returns None when the packet is malformed, so it contributes nothing.
 */
function readDescriptions(xmp: Buffer) {
  try {
    return findDescriptions(parseXmp(xmp));
  } catch {
    return [];
  }
}

/**
 * Returns a property's value from the first resource that has it, as an attribute or a child
 * element.
 *
 * @param resources - The resources, such as the packet's `rdf:Description` elements.
 * @param uri - The property's namespace URI.
 * @param local - The property's local name.
 */
function findProperty(
  resources: XmpNode[],
  uri: string,
  local: string
): XmpValue | undefined {
  const matches = (name: XmpName) => name.uri === uri && name.local === local;

  for (const resource of resources) {
    const value =
      resource.attributes.find(matches)?.value ??
      resource.children.find(matches);

    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/**
 * Returns the resources a structure's fields can sit on: its element, and any
 * `rdf:Description` inside it.
 *
 * @param node - The structure's element, such as an `rdf:li`.
 */
function resourcesOf(node: XmpNode) {
  return [
    node,
    ...node.children.filter((child) => isRdf(child, "Description")),
  ];
}

/**
 * Returns a simple value's text.
 *
 * @param value - The value.
 * @returns `undefined` for an element holding other elements, such as an array.
 */
function textOf(value: XmpValue | undefined) {
  if (typeof value === "string" || value === undefined) {
    return value;
  }
  return value.children.length === 0 ? value.text : undefined;
}

/**
 * Returns an array's items, or a lone value as the only item.
 *
 * @param value - The property's value.
 */
function itemsOf(value: XmpValue): XmpValue[] {
  if (typeof value === "string") {
    return [value];
  }

  const container = value.children.find(
    (child) => child.uri === rdf && RDF_CONTAINERS.has(child.local)
  );

  return container
    ? container.children.filter((child) => isRdf(child, "li"))
    : [value];
}

/**
 * Returns the text of each of an array's items.
 *
 * @param value - The property's value, if the packet has it.
 */
function textsOf(value: XmpValue | undefined) {
  return value === undefined
    ? undefined
    : itemsOf(value).flatMap((item) => textOf(item) ?? []);
}

/**
 * Returns the language of a language alternative.
 *
 * @param item - The alternative.
 */
function languageOf(item: XmpValue) {
  const lang =
    typeof item === "string"
      ? undefined
      : item.attributes.find(
          (attribute) => attribute.uri === xml && attribute.local === "lang"
        );

  return lang?.value ?? DEFAULT_LANGUAGE;
}

/**
 * Returns a Copyright Notice's language alternatives, `x-default` first.
 *
 * @param value - The `dc:rights` value, if the packet has it.
 */
function readCopyright(value: XmpValue | undefined) {
  const isDefault = (entry: { lang: string }) =>
    entry.lang.toLowerCase() === DEFAULT_LANGUAGE;

  if (value === undefined) {
    return undefined;
  }
  return itemsOf(value)
    .flatMap((item) => {
      const text = textOf(item);

      return text === undefined
        ? []
        : [{ lang: languageOf(item), value: text }];
    })
    .toSorted(
      (first, second) => Number(isDefault(second)) - Number(isDefault(first))
    );
}

/**
 * Returns the Licensor URLs of a `plus:Licensor` array of structures.
 *
 * @param value - The `plus:Licensor` value, if the packet has it.
 */
function readLicensorUrls(value: XmpValue | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return itemsOf(value).flatMap((item) => {
    const url =
      typeof item === "string"
        ? undefined
        : textOf(findProperty(resourcesOf(item), plus, "LicensorURL"));

    return url ?? [];
  });
}

/**
 * Reads the rights fields from an XMP packet, matching each property by its namespace URI and
 * reading a simple value from an attribute or an element alike.
 *
 * @param xmp - The packet, as UTF-8.
 * @returns The fields found, untrimmed. A malformed packet gives none.
 */
function readXmpRights(xmp: Buffer): ImageRights {
  const descriptions = readDescriptions(xmp);
  const property = (uri: string, local: string) =>
    findProperty(descriptions, uri, local);

  return {
    creator: textsOf(property(dc, "creator")),
    credit: textOf(property(photoshop, "Credit")),
    copyright: readCopyright(property(dc, "rights")),
    webStatement: textOf(property(xmpRights, "WebStatement")),
    licensorUrl: readLicensorUrls(property(plus, "Licensor")),
    digitalSourceType: textOf(property(Iptc4xmpExt, "DigitalSourceType")),
  };
}

export default readXmpRights;

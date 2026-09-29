/**
 * The namespace URIs the rights fields use, keyed by their usual prefix. Readers match by URI,
 * since a file may bind any prefix.
 */
const XMP_NAMESPACES = {
  x: "adobe:ns:meta/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xml: "http://www.w3.org/XML/1998/namespace",
  dc: "http://purl.org/dc/elements/1.1/",
  photoshop: "http://ns.adobe.com/photoshop/1.0/",
  xmpRights: "http://ns.adobe.com/xap/1.0/rights/",
  plus: "http://ns.useplus.org/ldf/xmp/1.0/",
  Iptc4xmpExt: "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
} as const;

export default XMP_NAMESPACES;

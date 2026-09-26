import type { XastChild, XastElement, XastParent, XastRoot } from "svgo";
import type { InspectSvg } from "./types.js";

type Svgo = typeof import("svgo");

type SvgScan = {
  comment: boolean;
  editor: boolean;
  details: InspectSvg;
};

const HREF_ATTRIBUTES = new Set(["href", "xlink:href"]);
const ID_LIST_ATTRIBUTES = new Set(["aria-labelledby", "aria-describedby"]);
const URL_REFERENCE = /url\(\s*['"]?#([^'")\s]+)/g;
const CSS_ID = /#([\w-]+)/g; // also matches hex colours, which aren't defined ids

/**
 * Parses SVG text into SVGO's syntax tree.
 *
 * @param svgo - The loaded SVGO module.
 * @param text - The SVG source.
 * @throws When the text isn't well-formed XML.
 */
function parseSvg(svgo: Svgo, text: string) {
  let tree: XastRoot = { type: "root", children: [] };

  // svgo 4 exports no parser (https://github.com/svg/svgo/issues/1611 exposed it in 2.x; the exports map hides it again), so a plugin that changes nothing captures its tree
  svgo.optimize(text, {
    plugins: [
      {
        name: "captureTree",
        fn: (root) => {
          tree = root;
        },
      },
    ],
  });
  return tree;
}

/**
 * Yields every node under a parent, depth first, with its parent.
 *
 * @param parent - The root or an element.
 */
function* walk(parent: XastParent): Generator<[XastChild, XastParent]> {
  for (const child of parent.children) {
    yield [child, parent];
    if (child.type === "element") {
      yield* walk(child);
    }
  }
}

/**
 * Adds the first capture group of every match of a global pattern to a set.
 *
 * @param text - The text to search.
 * @param pattern - A global pattern with one capture group.
 * @param into - The set to add to.
 */
function addMatches(text: string, pattern: RegExp, into: Set<string>) {
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) {
      into.add(match[1]);
    }
  }
}

/**
 * Adds the IDs an element's attributes refer to, and returns whether it carries editor data.
 *
 * @param element - The element.
 * @param references - The set of referenced IDs to add to.
 * @param editorNamespaces - SVGO's editor namespace URIs.
 */
function scanAttributes(
  element: XastElement,
  references: Set<string>,
  editorNamespaces: ReadonlySet<string>
) {
  let editor = element.name === "metadata";

  for (const [name, value] of Object.entries(element.attributes)) {
    if (
      (name === "xmlns" || name.startsWith("xmlns:")) &&
      editorNamespaces.has(value)
    ) {
      editor = true;
    }
    if (HREF_ATTRIBUTES.has(name) && value.startsWith("#")) {
      references.add(value.slice(1));
    }
    if (ID_LIST_ATTRIBUTES.has(name)) {
      for (const id of value.split(/\s+/)) {
        references.add(id);
      }
    }
    addMatches(value, URL_REFERENCE, references);
  }
  return editor;
}

/**
 * Scans an SVG for comments, editor data, its `viewBox`, its `<title>` and the IDs it refers to
 * internally.
 *
 * Editor data is what SVGO's `removeEditorsNSData` and `removeMetadata` plugins remove: a
 * namespace from SVGO's list of editor namespaces, or a `<metadata>` element.
 *
 * @param bytes - The SVG file's bytes, in UTF-8.
 * @throws When the SVG isn't well-formed XML.
 */
async function inspectSvg(bytes: Buffer): Promise<SvgScan> {
  const svgo = await import("svgo"); // takes about 250 ms, so only svg inputs pay for it
  const tree = parseSvg(svgo, new TextDecoder().decode(bytes));
  const definedIds = new Set<string>();
  const references = new Set<string>();
  const scan: SvgScan = {
    comment: false,
    editor: false,
    details: { viewBox: false, title: false, referencedIds: [] },
  };

  for (const [node, parent] of walk(tree)) {
    if (node.type === "comment" && !node.value.startsWith("!")) {
      scan.comment = true; // <!--! --> marks a licence notice, which svgo keeps
    } else if (
      (node.type === "text" || node.type === "cdata") &&
      parent.type === "element" &&
      parent.name === "style"
    ) {
      addMatches(node.value, CSS_ID, references);
    } else if (node.type === "element") {
      if (node.attributes.id !== undefined) {
        definedIds.add(node.attributes.id);
      }
      if (node.name === "title") {
        scan.details.title = true;
      }
      // removeEditorsNSData's own list, which svgo exports only as _collections
      if (
        scanAttributes(node, references, svgo._collections.editorNamespaces)
      ) {
        scan.editor = true;
      }
      if (parent === tree && node.name === "svg") {
        scan.details.viewBox = node.attributes.viewBox !== undefined;
      }
    }
  }
  scan.details.referencedIds = [...references]
    .filter((id) => definedIds.has(id))
    .toSorted();
  return scan;
}

export default inspectSvg;

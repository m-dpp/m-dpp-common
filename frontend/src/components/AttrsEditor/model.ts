/**
 * The AttrsEditor tree model: a plain JSON object ⇄ a tree of typed nodes.
 *
 * - leaf:    text | number | quantity | boolean | date | link | image
 *            (date     = ISO calendar date "YYYY-MM-DD";
 *             link     = an http(s) URL that is not an image — stored as a plain string;
 *             image    = a URL string pointing at an image — stored as a plain string,
 *                        recognised by extension, by an image format in its `fm=`/`format=`
 *                        query parameter, or as a data:image/ URI;
 *             quantity = a number with a unit of measure, stored as `{"value": 12, "unit": "cm"}`
 *                        — schema.org's QuantitativeValue shape, which GS1 Web Vocab shares.
 *                        With an empty unit it collapses back to a bare number, so data that
 *                        never had a unit is untouched.)
 * - complex: object (named children) | list (ordered, unnamed children)
 *
 * **Types are never stored.** Every leaf type is inferred from the shape of the value, so a
 * passport viewer that has only the JSON can render it the same way this editor does.
 *
 * Free-form: any key, any depth, no schema. All operations are immutable and
 * return new arrays so React state stays simple.
 */

export type LeafType = "text" | "number" | "quantity" | "boolean" | "date" | "link" | "image";
export type ComplexType = "object" | "list";
export type NodeType = LeafType | ComplexType;
export type LeafValue = string | number | boolean | null;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** The stored shape of a `quantity` leaf. */
export interface Quantity {
  value: number | null;
  unit: string;
}

export interface AttrNode {
  id: string;
  /** Name for children of an object; ignored (index is shown) for children of a list. */
  key: string;
  type: NodeType;
  /** Leaves only. For a `quantity` this is the numeric part. */
  value: LeafValue;
  /** `quantity` leaves only: the unit of measure ("cm", "kg", "gsm"…). */
  unit?: string;
  /** Complex nodes only. */
  children: AttrNode[];
  collapsed?: boolean;
}

export const LEAF_TYPES: LeafType[] = ["text", "number", "quantity", "boolean", "date", "link", "image"];
export const COMPLEX_TYPES: ComplexType[] = ["object", "list"];
export const NODE_TYPES: NodeType[] = [...LEAF_TYPES, ...COMPLEX_TYPES];

export function isComplex(type: NodeType): type is ComplexType {
  return type === "object" || type === "list";
}

let _seq = 0;
export function newId(): string {
  _seq += 1;
  return `n${_seq.toString(36)}${Date.now().toString(36).slice(-4)}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDateString(v: unknown): v is string {
  return typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?[^#]*)?(#.*)?$/i;
const IMAGE_DATA_RE = /^data:image\/[a-z0-9.+-]+[;,]/i;
// Image CDNs (imgix, Unsplash, Cloudinary-style) often serve `/photo-<id>?fm=jpg` with
// no extension in the path — the format lives in a query parameter instead.
const IMAGE_FORMAT_PARAMS = ["fm", "format"];
const IMAGE_FORMAT_RE = /^(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

/** An http(s) URL the browser can parse. Only ever http(s): a `javascript:` or `file:`
 *  value is text, however URL-shaped, so nothing here can become a clickable anchor by accident. */
export function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 4096) return false;
  const s = v.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

/** A string that points at an image: http(s) URL with an image extension (or an image
 *  format named in its `fm=`/`format=` query parameter), or a data:image URI. */
export function isImageUrl(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 4096) return false;
  const s = v.trim();
  if (IMAGE_DATA_RE.test(s)) return true;
  if (!isHttpUrl(s)) return false;
  const url = new URL(s);
  if (IMAGE_EXT_RE.test(url.pathname + (url.search || ""))) return true;
  return IMAGE_FORMAT_PARAMS.some((p) => IMAGE_FORMAT_RE.test(url.searchParams.get(p) ?? ""));
}

/** A general link: an http(s) URL that is not an image. The key it sits under is its label. */
export function isLinkUrl(v: unknown): v is string {
  return isHttpUrl(v) && !isImageUrl(v);
}

/** Safe to render in an <img>: http(s) or data:image only (never javascript: etc.). */
export function isRenderableImageSrc(v: unknown): v is string {
  return typeof v === "string" && (/^https?:\/\//i.test(v.trim()) || IMAGE_DATA_RE.test(v.trim()));
}

/** `{value, unit}` and nothing else: a number (or null while being typed) with a unit string.
 *  Any extra key makes it an ordinary object — the shape is the type, so it must be exact. */
export function isQuantity(v: unknown): v is Quantity {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !("value" in v) || !("unit" in v)) return false;
  const { value, unit } = v as Record<string, unknown>;
  return (typeof value === "number" || value === null) && typeof unit === "string";
}

export function inferType(v: unknown): NodeType {
  if (Array.isArray(v)) return "list";
  if (v !== null && typeof v === "object") return isQuantity(v) ? "quantity" : "object";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (isDateString(v)) return "date";
  if (isImageUrl(v)) return "image";
  if (isLinkUrl(v)) return "link";
  return "text";
}

export function newLeaf(type: LeafType = "text", key = "", value?: LeafValue, unit?: string): AttrNode {
  const node: AttrNode = { id: newId(), key, type, value: value ?? defaultValue(type), children: [] };
  if (type === "quantity") node.unit = unit ?? "";
  return node;
}

export function newComplex(type: ComplexType, key = ""): AttrNode {
  return { id: newId(), key, type, value: null, children: [] };
}

export function defaultValue(type: LeafType): LeafValue {
  switch (type) {
    case "number":
    case "quantity":
      return null;
    case "boolean":
      return false;
    case "date":
    case "link":
    case "image":
      return "";
    default:
      return "";
  }
}

// ---------------------------------------------------------------- JSON → tree

export function fromJsonValue(key: string, v: unknown): AttrNode {
  const type = inferType(v);
  if (type === "list") {
    return { id: newId(), key, type, value: null, children: (v as unknown[]).map((c, i) => fromJsonValue(String(i), c)) };
  }
  if (type === "object") {
    return {
      id: newId(),
      key,
      type,
      value: null,
      children: Object.entries(v as Record<string, unknown>).map(([k, c]) => fromJsonValue(k, c)),
    };
  }
  if (type === "quantity") {
    const q = v as Quantity;
    return { id: newId(), key, type, value: q.value, unit: q.unit, children: [] };
  }
  const value: LeafValue = v === undefined ? null : (v as LeafValue);
  return { id: newId(), key, type, value: type === "text" && value !== null && typeof value !== "string" ? String(value) : value, children: [] };
}

export function fromJson(obj: Record<string, unknown> | null | undefined): AttrNode[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([k, v]) => fromJsonValue(k, v));
}

// ---------------------------------------------------------------- tree → JSON

export function nodeToJson(node: AttrNode): JsonValue {
  if (node.type === "list") return node.children.map(nodeToJson);
  if (node.type === "object") return childrenToJson(node.children);
  if (node.type === "number") return typeof node.value === "number" ? node.value : null;
  if (node.type === "quantity") {
    const value = typeof node.value === "number" ? node.value : null;
    const unit = (node.unit ?? "").trim();
    // no unit → a bare number, so a quantity whose unit was cleared leaves no trace
    return unit ? { value, unit } : value;
  }
  if (node.type === "boolean") return node.value === true;
  return node.value === null || node.value === undefined ? null : String(node.value);
}

/** Children of an object → JSON. Empty keys are skipped; a duplicate key: the last one wins. */
export function childrenToJson(children: AttrNode[]): JsonObject {
  const out: JsonObject = {};
  for (const c of children) {
    const k = c.key.trim();
    if (!k) continue;
    out[k] = nodeToJson(c);
  }
  return out;
}

export function toJson(nodes: AttrNode[]): JsonObject {
  return childrenToJson(nodes);
}

// ---------------------------------------------------------------- import

/**
 * Merge a pasted JSON object into the top level of a tree: a key that already exists is
 * replaced in place (its position kept), a new key is appended. Nothing else is touched —
 * this is the editor-side twin of the API's merge PATCH. `replace` instead discards the
 * current tree and starts from the pasted object.
 */
export function mergeImported(nodes: AttrNode[], obj: Record<string, unknown>, mode: "merge" | "replace" = "merge"): AttrNode[] {
  const incoming = fromJson(obj);
  if (mode === "replace") return incoming;
  const out = nodes.slice();
  for (const n of incoming) {
    const at = out.findIndex((x) => x.key.trim() === n.key);
    if (at >= 0) out[at] = n;
    else out.push(n);
  }
  return out;
}

/** Parse pasted text as a JSON object. Throws with a message fit to show. */
export function parseImportedJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The JSON must be an object — a set of named attributes — not a list or a single value.");
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------- coercion

export function coerceValue(value: LeafValue, to: LeafType): LeafValue {
  switch (to) {
    case "number":
    case "quantity": {
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      const n = Number(String(value ?? "").trim());
      return String(value ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return value !== 0;
      const s = String(value ?? "").trim().toLowerCase();
      return s === "true" || s === "yes" || s === "1";
    }
    case "date":
      return isDateString(value) ? value : "";
    case "link":
    case "image":
      // keep whatever string is there (the user is about to paste/edit a URL); non-strings reset
      return typeof value === "string" ? value : "";
    default:
      return value === null || value === undefined ? "" : String(value);
  }
}

/** A copy of `node` with a new type. Leaf→complex starts empty; complex→leaf drops the
 *  subtree (ask the user first — see `hasChildren`). */
export function changeType(node: AttrNode, to: NodeType): AttrNode {
  if (to === node.type) return node;
  if (isComplex(to)) {
    if (isComplex(node.type)) {
      // object ⇄ list: keep children (keys are kept so object→list→object round-trips)
      return { ...node, type: to };
    }
    return { ...node, type: to, value: null, unit: undefined, children: [] };
  }
  const value = coerceValue(isComplex(node.type) ? null : node.value, to);
  return { ...node, type: to, value, unit: to === "quantity" ? node.unit ?? "" : undefined, children: [] };
}

export function hasChildren(node: AttrNode): boolean {
  return isComplex(node.type) && node.children.length > 0;
}

export function countDescendants(node: AttrNode): number {
  return node.children.reduce((n, c) => n + 1 + countDescendants(c), 0);
}

// ---------------------------------------------------------------- tree ops (immutable)

export function findNode(nodes: AttrNode[], id: string): AttrNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}

export function updateNode(nodes: AttrNode[], id: string, fn: (n: AttrNode) => AttrNode): AttrNode[] {
  let changed = false;
  const out = nodes.map((n) => {
    if (n.id === id) {
      changed = true;
      return fn(n);
    }
    const kids = updateNode(n.children, id, fn);
    if (kids !== n.children) {
      changed = true;
      return { ...n, children: kids };
    }
    return n;
  });
  return changed ? out : nodes;
}

export function removeNode(nodes: AttrNode[], id: string): AttrNode[] {
  if (nodes.some((n) => n.id === id)) return nodes.filter((n) => n.id !== id);
  let changed = false;
  const out = nodes.map((n) => {
    const kids = removeNode(n.children, id);
    if (kids !== n.children) {
      changed = true;
      return { ...n, children: kids };
    }
    return n;
  });
  return changed ? out : nodes;
}

/** Append `child` under `parentId` (null = root). */
export function addChild(nodes: AttrNode[], parentId: string | null, child: AttrNode): AttrNode[] {
  if (parentId === null) return [...nodes, child];
  return updateNode(nodes, parentId, (n) => ({ ...n, children: [...n.children, child], collapsed: false }));
}

export function moveChild(nodes: AttrNode[], parentId: string | null, from: number, to: number): AttrNode[] {
  const reorder = (arr: AttrNode[]) => {
    if (to < 0 || to >= arr.length || from === to) return arr;
    const copy = arr.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  };
  if (parentId === null) return reorder(nodes);
  return updateNode(nodes, parentId, (n) => ({ ...n, children: reorder(n.children) }));
}

/** Keys used more than once among an object's children (trimmed, non-empty). */
export function duplicateKeys(children: AttrNode[]): Set<string> {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of children) {
    const k = c.key.trim();
    if (!k) continue;
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return dup;
}

export function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../design/Button";
import { Input, Select, Textarea } from "../../design/Field";
import { Modal } from "../../design/Modal";
import { Notice } from "../../design/Notice";
import { SegmentedControl } from "../../design/SegmentedControl";
import { Toggle } from "../../design/Toggle";
import {
  AttrNode,
  ComplexType,
  JsonObject,
  LEAF_TYPES,
  LeafType,
  NODE_TYPES,
  NodeType,
  addChild,
  changeType,
  countDescendants,
  duplicateKeys,
  fromJson,
  fromJsonValue,
  hasChildren,
  isComplex,
  isHttpUrl,
  isRenderableImageSrc,
  mergeImported,
  newComplex,
  newLeaf,
  parseImportedJson,
  removeNode,
  stableStringify,
  toJson,
  updateNode,
} from "./model";
import s from "./AttrsEditor.module.css";

export type AttrsEditorMode = "view" | "edit";

/** Where a (top-level) attribute value came from. Inherited values render muted with a marker. */
export interface AttrProvenance {
  /** The source identifier (e.g. the GS1 path of the product that supplied the value). */
  source: string;
  /** Short label shown in the marker (e.g. the level: "model"). Falls back to `source`. */
  label?: string;
  /** True when the value was inherited rather than set on the entity itself. */
  inherited: boolean;
}

export interface AttrsEditorProps {
  value: Record<string, unknown> | null | undefined;
  /** Edit mode only: the full (visible + hidden pass-through) object after each change. */
  onChange?: (value: JsonObject) => void;
  /** `view` (default) is the common case; the host switches to `edit` deliberately. */
  mode?: AttrsEditorMode;
  /** Top-level keys shown but not editable (RBAC: readable, not writable). Applies to their subtree. */
  readOnlyKeys?: string[];
  /** Top-level keys not rendered at all. In edit mode they pass through to `onChange` unchanged. */
  hiddenKeys?: string[];
  /** Top-level key → source. Present only when the host has provenance (e.g. resolved reads). */
  provenance?: Record<string, AttrProvenance>;
  emptyText?: string;
  compact?: boolean;
  /** Edit mode: start with complex nodes collapsed. */
  collapsedByDefault?: boolean;
  /** Edit mode: offer "Import JSON" (paste an object; keys merge into the top level). Default true. */
  allowImport?: boolean;
  /** Offer "copy JSON" (the visible attributes, pretty-printed, to the clipboard). Default true. */
  allowCopy?: boolean;
}

const TYPE_LABEL: Record<NodeType, string> = {
  text: "text",
  number: "number",
  quantity: "number + unit",
  boolean: "boolean",
  date: "date",
  link: "link",
  image: "image link",
  object: "object",
  list: "list",
};

function shorten(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 3)}…` : s;
}

// ==================================================================== copy

/** Copies the attributes as pretty-printed JSON — the export half of Import JSON, so a
 *  bag can be carried from one product to another, or into a batch edit, through the
 *  clipboard. Falls back to a hidden textarea where the async clipboard is unavailable
 *  (plain-http pilot deployments are not a secure context).
 *
 *  Exported so a host that shows one bag in several pieces (own and inherited, say) can
 *  turn the per-view buttons off (`allowCopy={false}`) and offer ONE that copies the whole. */
export function CopyJsonButton({ getJson, className, label = "⧉ copy JSON", title = "Copy these attributes as JSON to the clipboard" }: { getJson: () => JsonObject; className?: string; label?: string; title?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  async function copy() {
    const text = JSON.stringify(getJson(), null, 2);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(ta);
    }
    setState(ok ? "copied" : "failed");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button type="button" className={[s.adderBtn, className ?? ""].join(" ")} onClick={copy} title={title}>
      {state === "copied" ? "✓ copied" : state === "failed" ? "could not copy" : label}
    </button>
  );
}

// ==================================================================== image

/** Small thumbnail for an image-link value; opens the full image in a new tab. Falls back
 *  to the URL as text when it cannot be loaded or is not a renderable source. */
function ImageThumb({ url, size = "sm" }: { url: string; size?: "sm" | "md" }) {
  const [broken, setBroken] = useState(false);
  const src = url.trim();
  if (!isRenderableImageSrc(src) || broken) {
    return (
      <span className={s.imgBroken} title={broken ? "image could not be loaded" : "not an http(s) or data:image URL"}>
        {shorten(src)}
      </span>
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer noopener" className={s.imgLink} title={src}>
      <img className={[s.thumb, size === "md" ? s.thumbMd : ""].join(" ")} src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
    </a>
  );
}

// ==================================================================== link

/** A general link: the URL as an anchor that opens in a new tab. Only ever rendered for an
 *  http(s) URL (`isHttpUrl`), so no other scheme can become clickable. */
function LinkAnchor({ url }: { url: string }) {
  const href = url.trim();
  if (!isHttpUrl(href)) return <span className={s.imgBroken}>{shorten(href)}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={s.link} title={href}>
      {shorten(href.replace(/^https?:\/\//i, ""), 72)}
      <span className={s.ext} aria-hidden>↗</span>
    </a>
  );
}

// ==================================================================== view

function ViewValue({ node }: { node: AttrNode }) {
  if (node.type === "quantity") {
    if (node.value === null || node.value === undefined) return <span className={s.nil}>—</span>;
    return (
      <span>
        <span className={s.num}>{String(node.value)}</span>
        {node.unit?.trim() && <span className={s.unit}> {node.unit.trim()}</span>}
      </span>
    );
  }
  if (node.value === null || node.value === undefined || node.value === "") return <span className={s.nil}>—</span>;
  if (node.type === "number") return <span className={s.num}>{String(node.value)}</span>;
  if (node.type === "boolean") return <span className={s.bool}>{node.value ? "true" : "false"}</span>;
  if (node.type === "image") return <ImageThumb url={String(node.value)} />;
  if (node.type === "link") return <LinkAnchor url={String(node.value)} />;
  return <span>{String(node.value)}</span>;
}

function ViewRow({ node, inList, provenance }: { node: AttrNode; inList: boolean; provenance?: AttrProvenance }) {
  const inherited = provenance?.inherited === true;
  const keyEl = inList ? <span className={s.index}>[{node.key}]</span> : <span className={s.key}>{node.key}</span>;
  const marker = inherited ? (
    <span className={s.source} title={`inherited from ${provenance!.source}`}>
      {provenance!.label ?? provenance!.source}
    </span>
  ) : null;

  if (isComplex(node.type)) {
    return (
      <div className={[s.vrow, s.vrowComplex, inherited ? s.inherited : ""].join(" ")}>
        <div className={s.vkey}>
          {keyEl}
          <span className={s.typeHint}>
            {TYPE_LABEL[node.type]} · {node.children.length}
          </span>
          {marker}
        </div>
        {node.children.length > 0 && (
          <div className={s.children}>
            {node.children.map((c) => (
              <ViewRow key={c.id} node={c} inList={node.type === "list"} />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={[s.vrow, inherited ? s.inherited : ""].join(" ")}>
      <div className={s.vkey}>{keyEl}</div>
      <div className={s.vval}>
        <ViewValue node={node} />
        {marker}
      </div>
    </div>
  );
}

// ==================================================================== edit

interface EditCtx {
  onKey: (id: string, key: string) => void;
  onType: (id: string, to: NodeType) => void;
  onValue: (id: string, v: AttrNode["value"]) => void;
  onUnit: (id: string, unit: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string | null, kind: NodeType) => void;
}

function Adders({ parentId, ctx, root, onImport, getJson }: { parentId: string | null; ctx: EditCtx; root?: boolean; onImport?: () => void; getJson?: () => JsonObject }) {
  return (
    <div className={[s.adders, root ? s.rootAdders : ""].join(" ")}>
      <button type="button" className={s.adderBtn} onClick={() => ctx.onAdd(parentId, "text")}>
        ＋ field
      </button>
      <button type="button" className={s.adderBtn} onClick={() => ctx.onAdd(parentId, "object")}>
        ＋ object
      </button>
      <button type="button" className={s.adderBtn} onClick={() => ctx.onAdd(parentId, "list")}>
        ＋ list
      </button>
      {(onImport || getJson) && <span className={s.spacer} />}
      {getJson && <CopyJsonButton getJson={getJson} />}
      {onImport && (
        <button type="button" className={s.adderBtn} onClick={onImport} title="Paste a JSON object; its keys are merged into the attributes">
          ⤓ import JSON
        </button>
      )}
    </div>
  );
}

function LeafInput({ node, disabled, onValue, onUnit }: { node: AttrNode; disabled?: boolean; onValue: (v: AttrNode["value"]) => void; onUnit: (u: string) => void }) {
  switch (node.type) {
    case "number":
      return (
        <Input
          size_="sm"
          type="number"
          step="any"
          disabled={disabled}
          value={node.value === null || node.value === undefined ? "" : String(node.value)}
          onChange={(e) => onValue(e.target.value === "" ? null : Number(e.target.value))}
          placeholder="number"
        />
      );
    case "quantity":
      return (
        <div className={s.qtyEdit}>
          <Input
            size_="sm"
            type="number"
            step="any"
            disabled={disabled}
            value={node.value === null || node.value === undefined ? "" : String(node.value)}
            onChange={(e) => onValue(e.target.value === "" ? null : Number(e.target.value))}
            placeholder="number"
          />
          <Input
            size_="sm"
            className={s.unitInput}
            disabled={disabled}
            value={node.unit ?? ""}
            onChange={(e) => onUnit(e.target.value)}
            placeholder="unit"
            title="Unit of measure (cm, kg, gsm, %…). Stored as {value, unit}; leave it empty for a bare number."
            aria-label="unit"
          />
        </div>
      );
    case "boolean":
      return (
        <div className={s.boolCell}>
          <Toggle checked={node.value === true} disabled={disabled} onChange={(v) => onValue(v)} label={node.value ? "true" : "false"} />
        </div>
      );
    case "date":
      return <Input size_="sm" type="date" disabled={disabled} value={typeof node.value === "string" ? node.value : ""} onChange={(e) => onValue(e.target.value)} />;
    case "link": {
      const url = typeof node.value === "string" ? node.value : "";
      return (
        <div className={s.imgEdit}>
          <Input size_="sm" type="url" mono disabled={disabled} value={url} placeholder="https://…" onChange={(e) => onValue(e.target.value)} title="Stored as a plain URL string; shown as a link that opens in a new tab. The attribute's name is the link's label." />
          {isHttpUrl(url) && (
            <a href={url.trim()} target="_blank" rel="noreferrer noopener" className={s.openLink} title="Open in a new tab">
              open ↗
            </a>
          )}
        </div>
      );
    }
    case "image": {
      const url = typeof node.value === "string" ? node.value : "";
      return (
        <div className={s.imgEdit}>
          <Input size_="sm" type="url" mono disabled={disabled} value={url} placeholder="https://…/photo.jpg" onChange={(e) => onValue(e.target.value)} title="Stored as a plain URL string; recognised as an image by its extension (.png .jpg .webp …), by an fm=/format= query parameter, or as a data:image URI" />
          {url.trim() && <ImageThumb url={url} />}
        </div>
      );
    }
    default:
      return <Input size_="sm" disabled={disabled} value={node.value === null || node.value === undefined ? "" : String(node.value)} onChange={(e) => onValue(e.target.value)} placeholder="value" />;
  }
}

function EditRow({
  node,
  inList,
  dup,
  readOnly,
  ctx,
  provenance,
}: {
  node: AttrNode;
  inList: boolean;
  dup: boolean;
  readOnly: boolean;
  ctx: EditCtx;
  provenance?: AttrProvenance;
}) {
  const complex = isComplex(node.type);
  const dups = complex && node.type === "object" ? duplicateKeys(node.children) : new Set<string>();
  const row = (
    <div className={[s.erow, readOnly ? s.readonly : ""].join(" ")}>
      {complex ? (
        <button type="button" className={s.toggle} onClick={() => ctx.onToggle(node.id)} aria-label={node.collapsed ? "Expand" : "Collapse"}>
          {node.collapsed ? "▶" : "▼"}
        </button>
      ) : (
        <span className={s.togglePlaceholder} />
      )}
      {inList ? (
        <span className={s.indexBox}>[{node.key}]</span>
      ) : (
        <Input size_="sm" mono className={dup ? s.dup : undefined} disabled={readOnly} value={node.key} placeholder="name" onChange={(e) => ctx.onKey(node.id, e.target.value)} title={dup ? "Duplicate name — the last one wins" : undefined} />
      )}
      <Select size_="sm" disabled={readOnly} value={node.type} onChange={(e) => ctx.onType(node.id, e.target.value as NodeType)} options={NODE_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))} aria-label="type" />
      {complex ? (
        <span className={s.summary}>
          <span>
            {node.children.length} {node.type === "list" ? "item" : "field"}
            {node.children.length === 1 ? "" : "s"}
          </span>
        </span>
      ) : (
        <LeafInput node={node} disabled={readOnly} onValue={(v) => ctx.onValue(node.id, v)} onUnit={(u) => ctx.onUnit(node.id, u)} />
      )}
      <button type="button" className={s.remove} disabled={readOnly} onClick={() => ctx.onRemove(node.id)} aria-label="Remove" title={complex ? "Remove (and its children)" : "Remove"}>
        ×
      </button>
      {provenance?.inherited && (
        <div className={[s.provEdit, "mdpp-xs", "mdpp-muted"].join(" ")}>
          Inherited from {provenance.label ?? provenance.source}. Editing it here sets an own value that overrides the inherited one.
        </div>
      )}
    </div>
  );
  if (!complex) return row;
  return (
    <div className={s.ecomplex}>
      {row}
      {!node.collapsed && (
        <>
          <div className={s.children}>
            {node.children.map((c) => (
              <EditRow key={c.id} node={c} inList={node.type === "list"} dup={dups.has(c.key.trim())} readOnly={readOnly} ctx={ctx} />
            ))}
          </div>
          {!readOnly && <Adders parentId={node.id} ctx={ctx} />}
        </>
      )}
    </div>
  );
}

// ==================================================================== import

type ImportMode = "merge" | "replace";

/** Paste a JSON object. Types are inferred from the values exactly as they are for stored
 *  data, so a URL becomes a link, an image URL an image, `{value, unit}` a quantity. */
function ImportModal({ open, onClose, onApply, currentKeys }: { open: boolean; onClose: () => void; onApply: (obj: Record<string, unknown>, mode: ImportMode) => void; currentKeys: string[] }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setText("");
    setMode("merge");
    setErr(null);
  }, [open]);

  const preview = useMemo(() => {
    if (!text.trim()) return null;
    try {
      const obj = parseImportedJson(text);
      const keys = Object.keys(obj);
      const replaced = keys.filter((k) => currentKeys.includes(k));
      return { keys, replaced, error: null as string | null };
    } catch (e) {
      return { keys: [] as string[], replaced: [] as string[], error: (e as Error).message };
    }
  }, [text, currentKeys]);

  function apply() {
    try {
      onApply(parseImportedJson(text), mode);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Import JSON"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!preview || !!preview.error} onClick={apply}>
            {mode === "replace" ? "Replace attributes" : `Merge ${preview?.keys.length ?? 0} key${preview?.keys.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className={s.importBox}>
        <Textarea
          className={s.importText}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'{\n  "label": "Merino scarf",\n  "care_instructions": "https://example.com/care",\n  "width": { "value": 30, "unit": "cm" }\n}'}
          spellCheck={false}
          autoFocus
          invalid={!!preview?.error}
        />
        <div className={s.importHead}>
          <SegmentedControl<ImportMode>
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: "merge", label: "Merge" },
              { value: "replace", label: "Replace all" },
            ]}
            aria-label="Import mode"
          />
          <span className="mdpp-muted mdpp-xs">
            {mode === "merge"
              ? "Pasted keys are set; a key that already exists is overwritten, every other attribute is left as it is."
              : "The current attributes are discarded and the pasted object is used instead."}
          </span>
        </div>
        {(err || preview?.error) && <Notice tone="error">{err ?? preview?.error}</Notice>}
        {preview && !preview.error && (
          <span className="mdpp-muted mdpp-xs">
            {preview.keys.length} key{preview.keys.length === 1 ? "" : "s"}
            {mode === "merge" && preview.replaced.length > 0 && <> · overwrites {preview.replaced.join(", ")}</>}
            . URLs become links, image URLs image links, <code>{"{value, unit}"}</code> a number with a unit, <code>YYYY-MM-DD</code> a date.
          </span>
        )}
      </div>
    </Modal>
  );
}

// ==================================================================== component

export function AttrsEditor({
  value,
  onChange,
  mode = "view",
  readOnlyKeys,
  hiddenKeys,
  provenance,
  emptyText = "No attributes",
  compact,
  collapsedByDefault,
  allowImport = true,
  allowCopy = true,
}: AttrsEditorProps) {
  const hidden = useMemo(() => new Set(hiddenKeys ?? []), [hiddenKeys]);
  const readOnly = useMemo(() => new Set(readOnlyKeys ?? []), [readOnlyKeys]);

  const visibleValue = useMemo(() => {
    const src = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(src).filter(([k]) => !hidden.has(k)));
  }, [value, hidden]);
  const hiddenValue = useMemo(() => {
    const src = (value ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(src).filter(([k]) => hidden.has(k))) as JsonObject;
  }, [value, hidden]);

  // ---- edit state: derived from `value`, re-derived only when the host sends
  // something we did not just emit (so echoing onChange back does not reset rows).
  const [nodes, setNodes] = useState<AttrNode[]>(() => fromJson(visibleValue));
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    const incoming = stableStringify(visibleValue);
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = null;
    setNodes(fromJson(visibleValue).map((n) => (collapsedByDefault && isComplex(n.type) ? { ...n, collapsed: true } : n)));
  }, [visibleValue, collapsedByDefault]);

  const emit = useCallback(
    (next: AttrNode[]) => {
      setNodes(next);
      if (!onChange) return;
      const out = { ...toJson(next), ...hiddenValue };
      lastEmitted.current = stableStringify(Object.fromEntries(Object.entries(out).filter(([k]) => !hidden.has(k))));
      onChange(out);
    },
    [onChange, hiddenValue, hidden],
  );

  const [pendingType, setPendingType] = useState<{ id: string; to: NodeType; count: number } | null>(null);
  const [importing, setImporting] = useState(false);

  const ctx: EditCtx = useMemo(
    () => ({
      onKey: (id, key) => emit(updateNode(nodes, id, (n) => ({ ...n, key }))),
      onType: (id, to) => {
        const target = nodes && findInTree(nodes, id);
        if (target && hasChildren(target) && !isComplex(to)) {
          setPendingType({ id, to, count: countDescendants(target) });
          return;
        }
        emit(updateNode(nodes, id, (n) => changeType(n, to)));
      },
      onValue: (id, v) => emit(updateNode(nodes, id, (n) => ({ ...n, value: v }))),
      onUnit: (id, unit) => emit(updateNode(nodes, id, (n) => ({ ...n, unit }))),
      onRemove: (id) => emit(removeNode(nodes, id)),
      onToggle: (id) => setNodes(updateNode(nodes, id, (n) => ({ ...n, collapsed: !n.collapsed }))),
      onAdd: (parentId, kind) => {
        const child = isComplex(kind) ? newComplex(kind as ComplexType) : newLeaf(kind as LeafType);
        emit(addChild(nodes, parentId, child));
      },
    }),
    [nodes, emit],
  );

  // Importing never touches a read-only key: those rows are dropped from the pasted object
  // before the merge, and kept from the current tree on a replace, so the editor cannot
  // produce a patch the server would refuse anyway.
  const applyImport = (obj: Record<string, unknown>, importMode: ImportMode) => {
    const allowed = Object.fromEntries(Object.entries(obj).filter(([k]) => !readOnly.has(k)));
    if (importMode === "replace") {
      const kept = nodes.filter((n) => readOnly.has(n.key.trim()));
      emit([...kept, ...mergeImported([], allowed, "replace")]);
      return;
    }
    emit(mergeImported(nodes, allowed, "merge"));
  };

  if (mode === "view") {
    const viewNodes = fromJson(visibleValue);
    return (
      <div className={[s.root, compact ? s.compact : ""].join(" ")}>
        {viewNodes.length === 0 ? (
          <div className={s.empty}>{emptyText}</div>
        ) : (
          <>
            {viewNodes.map((n) => <ViewRow key={n.id} node={n} inList={false} provenance={provenance?.[n.key]} />)}
            {allowCopy && (
              <div className={s.viewTools}>
                <CopyJsonButton getJson={() => visibleValue as JsonObject} />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const dups = duplicateKeys(nodes);
  return (
    <div className={s.root}>
      {nodes.length === 0 && <div className={s.empty}>{emptyText}</div>}
      {nodes.map((n) => (
        <EditRow key={n.id} node={n} inList={false} dup={dups.has(n.key.trim())} readOnly={readOnly.has(n.key)} ctx={ctx} provenance={provenance?.[n.key]} />
      ))}
      <Adders parentId={null} ctx={ctx} root onImport={allowImport ? () => setImporting(true) : undefined} getJson={allowCopy && nodes.length > 0 ? () => toJson(nodes) : undefined} />
      {allowImport && <ImportModal open={importing} onClose={() => setImporting(false)} onApply={applyImport} currentKeys={nodes.map((n) => n.key.trim())} />}
      <Modal
        open={pendingType !== null}
        onClose={() => setPendingType(null)}
        title="Change type and discard children?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingType(null)}>
              Keep as is
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingType) emit(updateNode(nodes, pendingType.id, (n) => changeType(n, pendingType.to)));
                setPendingType(null);
              }}
            >
              Change to {pendingType ? TYPE_LABEL[pendingType.to] : ""}
            </Button>
          </>
        }
      >
        <p>
          This node contains {pendingType?.count} nested value{pendingType?.count === 1 ? "" : "s"}. Changing it to a {pendingType ? TYPE_LABEL[pendingType.to] : ""} removes all of them.
        </p>
      </Modal>
    </div>
  );
}

function findInTree(nodes: AttrNode[], id: string): AttrNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findInTree(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Read-only rendering — the same component fixed in `view` mode. */
export function AttrsViewer(props: Omit<AttrsEditorProps, "mode" | "onChange">) {
  return <AttrsEditor {...props} mode="view" />;
}

export { fromJson, fromJsonValue, toJson, LEAF_TYPES };
export type { AttrNode, NodeType, LeafType, JsonObject };

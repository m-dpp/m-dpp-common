import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../design/Button";
import { Input, Select } from "../../design/Field";
import { Modal } from "../../design/Modal";
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
  newComplex,
  newLeaf,
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
}

const TYPE_LABEL: Record<NodeType, string> = {
  text: "text",
  number: "number",
  boolean: "boolean",
  date: "date",
  object: "object",
  list: "list",
};

// ==================================================================== view

function ViewValue({ node }: { node: AttrNode }) {
  if (node.value === null || node.value === undefined || node.value === "") return <span className={s.nil}>—</span>;
  if (node.type === "number") return <span className={s.num}>{String(node.value)}</span>;
  if (node.type === "boolean") return <span className={s.bool}>{node.value ? "true" : "false"}</span>;
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
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onAdd: (parentId: string | null, kind: NodeType) => void;
}

function Adders({ parentId, ctx, root }: { parentId: string | null; ctx: EditCtx; root?: boolean }) {
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
    </div>
  );
}

function LeafInput({ node, disabled, onValue }: { node: AttrNode; disabled?: boolean; onValue: (v: AttrNode["value"]) => void }) {
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
    case "boolean":
      return (
        <div className={s.boolCell}>
          <Toggle checked={node.value === true} disabled={disabled} onChange={(v) => onValue(v)} label={node.value ? "true" : "false"} />
        </div>
      );
    case "date":
      return <Input size_="sm" type="date" disabled={disabled} value={typeof node.value === "string" ? node.value : ""} onChange={(e) => onValue(e.target.value)} />;
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
        <LeafInput node={node} disabled={readOnly} onValue={(v) => ctx.onValue(node.id, v)} />
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
      onRemove: (id) => emit(removeNode(nodes, id)),
      onToggle: (id) => setNodes(updateNode(nodes, id, (n) => ({ ...n, collapsed: !n.collapsed }))),
      onAdd: (parentId, kind) => {
        const child = isComplex(kind) ? newComplex(kind as ComplexType) : newLeaf(kind as LeafType);
        emit(addChild(nodes, parentId, child));
      },
    }),
    [nodes, emit],
  );

  if (mode === "view") {
    const viewNodes = fromJson(visibleValue);
    return (
      <div className={[s.root, compact ? s.compact : ""].join(" ")}>
        {viewNodes.length === 0 ? (
          <div className={s.empty}>{emptyText}</div>
        ) : (
          viewNodes.map((n) => <ViewRow key={n.id} node={n} inList={false} provenance={provenance?.[n.key]} />)
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
      <Adders parentId={null} ctx={ctx} root />
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

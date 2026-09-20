import { useMemo, useState } from "react";
import { usePrincipal } from "../../api/principal";
import { AttrsEditor, AttrsViewer } from "../../components/AttrsEditor/AttrsEditor";
import { attrsPatch } from "../../components/attrsPatch";
import { Button } from "../../design/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../../design/Card";
import { Chip, Tag } from "../../design/Chip";
import { EmptyState } from "../../design/EmptyState";
import { Field, LabelledInput, LabelledSelect } from "../../design/Field";
import { Modal } from "../../design/Modal";
import { Notice } from "../../design/Notice";
import { Toggle } from "../../design/Toggle";
import { errorMessage, useAsync } from "../../hooks/useAsync";
import { useMdpp } from "../../mdpp/context";
import type { FibreNode } from "../../mdpp/types";
import s from "./mdpp.module.css";

/**
 * The fibre taxonomy — the composition hierarchy every declaration and every
 * result is expressed in.
 *
 * Two things elsewhere in the system are *defined here*, which is why this is a
 * screen and not a config file:
 *
 * - **`legal_name`** marks a legally-binding fibre name under EU 1007/2011.
 *   The comparison's official-fibre verdict resolves to the nearest
 *   ancestor-or-self carrying this flag — which is how merino and rambouillet
 *   both come out as "wool".
 * - **`tolerance`** (an attribute, in absolute percentage points) is what every
 *   quantity verdict is measured against. It is inherited **nearest
 *   ancestor-or-self wins**, so setting it on a family covers everything
 *   beneath it until a child overrides it.
 *
 * Both are shown resolved on a node, so the effect of an edit is visible here
 * rather than only in a comparison somewhere else.
 */
export interface FibreTaxonomyProps {
  /** The RBAC resource type the taxonomy is gated on in the host's policy. */
  resourceType?: string;
}

interface TreeNode {
  node: FibreNode;
  children: TreeNode[];
}

const TOLERANCE_KEY = "tolerance";

function buildForest(nodes: FibreNode[]): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, { node: n, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const t of byId.values()) {
    const parent = t.node.parent_id ? byId.get(t.node.parent_id) : undefined;
    if (parent) parent.children.push(t);
    else roots.push(t);
  }
  const sort = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.node.label.localeCompare(b.node.label));
    arr.forEach((t) => sort(t.children));
  };
  sort(roots);
  return roots;
}

/** Self first, then ancestors up to the root. */
function chainOf(node: FibreNode, byId: Map<string, FibreNode>): FibreNode[] {
  const out: FibreNode[] = [];
  const seen = new Set<string>();
  let cur: FibreNode | undefined = node;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return out;
}

function toleranceOf(n: FibreNode): number | null {
  const raw = (n.attrs ?? {})[TOLERANCE_KEY];
  const v = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The same nearest-wins walk the backend does, so the screen shows what a
 *  comparison would actually apply. */
function resolveTolerance(node: FibreNode, byId: Map<string, FibreNode>): { value: number; from: FibreNode } | null {
  for (const n of chainOf(node, byId)) {
    const v = toleranceOf(n);
    if (v !== null) return { value: v, from: n };
  }
  return null;
}

function resolveOfficial(node: FibreNode, byId: Map<string, FibreNode>): FibreNode | null {
  return chainOf(node, byId).find((n) => n.legal_name) ?? null;
}

export function FibreTaxonomy({ resourceType = "fibre_nodes" }: FibreTaxonomyProps) {
  const mdpp = useMdpp();
  const { can } = usePrincipal();
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const nodes = useAsync(() => mdpp.listFibreNodes({ includeRemoved }), [mdpp, includeRemoved]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const all = nodes.data ?? [];
  const byId = useMemo(() => new Map(all.map((n) => [n.id, n])), [all]);
  const forest = useMemo(() => buildForest(all), [all]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const mayWrite = can(resourceType, "update");
  const mayCreate = can(resourceType, "create");

  return (
    <div className={s.taxonomyLayout}>
      <Card>
        <CardHeader
          title="Fibre taxonomy"
          subtitle={`${all.length} node${all.length === 1 ? "" : "s"}`}
          actions={mayCreate && <Button size="sm" onClick={() => setCreating(true)}>Add fibre</Button>}
        />
        <CardBody>
          <Field label="">
            <Toggle
              checked={includeRemoved}
              onChange={(v) => setIncludeRemoved(v)}
              label="Show removed nodes"
            />
          </Field>
          {nodes.error && <Notice tone="error">{nodes.error}</Notice>}
          {forest.length === 0 ? (
            <EmptyState
              compact
              title={nodes.loading ? "Loading…" : "No fibres yet"}
              description="The taxonomy is what declarations and results are expressed in."
            />
          ) : (
            <div className={s.tree} role="tree">
              {forest.map((t) => (
                <TreeRow
                  key={t.node.id}
                  tree={t}
                  depth={0}
                  byId={byId}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {selected ? (
        <NodeEditor
          key={selected.id}
          node={selected}
          all={all}
          byId={byId}
          canWrite={mayWrite}
          canDelete={can(resourceType, "delete")}
          onChanged={async () => { await nodes.reload(); }}
          onSelect={setSelectedId}
        />
      ) : (
        <Card>
          <CardBody>
            <EmptyState
              title="Select a fibre"
              description="Pick a node to edit its label, where it sits in the tree, whether it is a legal fibre name, and its tolerance."
            />
          </CardBody>
        </Card>
      )}

      {creating && (
        <NodeModal
          all={all}
          parentId={selectedId}
          onClose={() => setCreating(false)}
          onSaved={async (created) => {
            setCreating(false);
            await nodes.reload();
            setSelectedId(created.id);
          }}
        />
      )}
    </div>
  );
}

// ── tree ─────────────────────────────────────────────────────────────────

function TreeRow({
  tree,
  depth,
  byId,
  selectedId,
  onSelect,
}: {
  tree: TreeNode;
  depth: number;
  byId: Map<string, FibreNode>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const n = tree.node;
  const own = toleranceOf(n);
  const resolved = resolveTolerance(n, byId);
  const removed = Boolean(n.removed_at);

  return (
    <div>
      <div
        role="treeitem"
        aria-selected={n.id === selectedId}
        className={[
          s.treeNode,
          n.id === selectedId ? s.treeNodeSelected : "",
          removed ? s.treeNodeRemoved : "",
        ].filter(Boolean).join(" ")}
        onClick={() => onSelect(n.id)}
      >
        {tree.children.length > 0 ? (
          <button
            type="button"
            className={s.twisty}
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? "▼" : "▶"}
          </button>
        ) : (
          <span className={s.twistySpacer} />
        )}
        <span className={s.nodeLabel}>{n.label}</span>
        {n.legal_name && <Tag title="Legally-binding fibre name (EU 1007/2011)">legal</Tag>}
        {resolved && (
          <Chip
            className={[s.tolBadge, own === null ? s.inheritedTol : ""].filter(Boolean).join(" ")}
            title={
              own === null
                ? `±${resolved.value} pp, inherited from ${resolved.from.label}`
                : `±${resolved.value} pp, set on this fibre`
            }
          >
            ±{resolved.value}
          </Chip>
        )}
      </div>
      {open && tree.children.length > 0 && (
        <div className={s.treeChildren}>
          {tree.children.map((c) => (
            <TreeRow key={c.node.id} tree={c} depth={depth + 1} byId={byId} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── node editor ──────────────────────────────────────────────────────────

function NodeEditor({
  node,
  all,
  byId,
  canWrite,
  canDelete,
  onChanged,
  onSelect,
}: {
  node: FibreNode;
  all: FibreNode[];
  byId: Map<string, FibreNode>;
  canWrite: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onSelect: (id: string) => void;
}) {
  const mdpp = useMdpp();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [parentId, setParentId] = useState(node.parent_id ?? "");
  const [legal, setLegal] = useState(node.legal_name);
  const [legalRef, setLegalRef] = useState(node.legal_ref ?? "");
  const [attrs, setAttrs] = useState<Record<string, unknown>>({ ...(node.attrs ?? {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const official = resolveOfficial(node, byId);
  const resolved = resolveTolerance(node, byId);
  const ownTolerance = toleranceOf(node);

  // A node may not become its own descendant, so its subtree is not a candidate.
  const descendantIds = useMemo(() => {
    const out = new Set<string>([node.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of all) {
        if (n.parent_id && out.has(n.parent_id) && !out.has(n.id)) {
          out.add(n.id);
          grew = true;
        }
      }
    }
    return out;
  }, [all, node.id]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await mdpp.updateFibreNode(node.id, {
        label,
        parent_id: parentId || null,
        legal_name: legal,
        legal_ref: legalRef || null,
        attrs: attrsPatch(node.attrs ?? {}, attrs),
      });
      setEditing(false);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await mdpp.removeFibreNode(node.id);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await mdpp.restoreFibreNode(node.id);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={node.label}
        subtitle={node.slug}
        actions={
          canWrite && !node.removed_at && !editing && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          )
        }
      />
      <CardBody>
        <div className={s.detailGrid}>
          {node.removed_at && (
            <Notice tone="warn">
              This fibre is removed. It stays readable so existing declarations and results that
              reference it still resolve.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}

          {editing ? (
            <>
              <LabelledInput label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
              <LabelledSelect label="Parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">— a root fibre —</option>
                {all
                  .filter((n) => !descendantIds.has(n.id) && !n.removed_at)
                  .sort((a, b) => a.label.localeCompare(b.label))
                  .map((n) => (
                    <option key={n.id} value={n.id}>{n.label}</option>
                  ))}
              </LabelledSelect>
              <Field
                label="Legal fibre name"
                hint="A legally-binding name under EU 1007/2011. The official-fibre verdict resolves to the nearest ancestor-or-self carrying this flag."
              >
                <Toggle checked={legal} onChange={setLegal} label={legal ? "Yes" : "No"} />
              </Field>
              <LabelledInput
                label="Legal reference"
                placeholder="Reg. (EU) No 1007/2011, Annex I"
                value={legalRef}
                onChange={(e) => setLegalRef(e.target.value)}
              />
              <Field
                label="Attributes"
                hint={`"${TOLERANCE_KEY}" (absolute percentage points) is what every quantity verdict is measured against, and is inherited by descendants that do not set their own.`}
              >
                <AttrsEditor value={attrs} mode="edit" onChange={setAttrs} />
              </Field>
            </>
          ) : (
            <>
              <div className={s.versionRow}>
                <span>Official fibre name</span>
                <span>
                  {official
                    ? official.id === node.id
                      ? <Chip tone="ok" dot>this fibre is a legal name</Chip>
                      : <Chip tone="ok">{official.label}</Chip>
                    : <Chip tone="warn">none in this branch</Chip>}
                </span>
              </div>
              <div className={s.versionRow}>
                <span>Tolerance applied</span>
                <span>
                  {resolved ? (
                    <span className="mdpp-row" style={{ gap: 6 }}>
                      <Chip tone="accent">±{resolved.value} pp</Chip>
                      {ownTolerance === null
                        ? <span className={s.sub}>inherited from {resolved.from.label}</span>
                        : <span className={s.sub}>set on this fibre</span>}
                    </span>
                  ) : (
                    <Chip tone="warn">none — quantity verdicts here read "unknown"</Chip>
                  )}
                </span>
              </div>
              <Field label="Attributes">
                <AttrsViewer value={node.attrs ?? {}} emptyText="No attributes on this fibre." />
              </Field>
            </>
          )}
        </div>
      </CardBody>

      {editing ? (
        <CardFooter>
          <Button variant="ghost" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
          <Button onClick={save} disabled={busy || !label.trim()}>{busy ? "Saving…" : "Save"}</Button>
        </CardFooter>
      ) : (
        (canDelete || node.parent_id) && (
          <CardFooter>
            {node.parent_id && (
              <Button size="sm" variant="ghost" onClick={() => onSelect(node.parent_id!)}>
                Go to parent
              </Button>
            )}
            {canDelete && !node.removed_at && (
              <Button size="sm" variant="danger" disabled={busy} onClick={remove}>Remove</Button>
            )}
            {canDelete && node.removed_at && (
              <Button size="sm" variant="outline" disabled={busy} onClick={restore}>Restore</Button>
            )}
          </CardFooter>
        )
      )}
    </Card>
  );
}

// ── create ───────────────────────────────────────────────────────────────

function NodeModal({
  all,
  parentId,
  onClose,
  onSaved,
}: {
  all: FibreNode[];
  parentId: string | null;
  onClose: () => void;
  onSaved: (created: FibreNode) => void | Promise<void>;
}) {
  const mdpp = useMdpp();
  const [label, setLabel] = useState("");
  const [parent, setParent] = useState(parentId ?? "");
  const [legal, setLegal] = useState(false);
  const [tolerance, setTolerance] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const attrs: Record<string, unknown> = {};
      const t = Number.parseFloat(tolerance);
      if (tolerance !== "" && Number.isFinite(t)) attrs[TOLERANCE_KEY] = t;
      const created = await mdpp.createFibreNode({
        label: label.trim(),
        parent_id: parent || null,
        legal_name: legal,
        legal_ref: legal ? "Reg. (EU) No 1007/2011, Annex I" : null,
        attrs,
      });
      await onSaved(created);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Add a fibre"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !label.trim()}>{busy ? "Adding…" : "Add fibre"}</Button>
        </>
      }
    >
      <div className={s.detailGrid}>
        <LabelledInput
          label="Label"
          placeholder="Rambouillet"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          hint="The slug is derived from this and must stay stable — labs reference fibres by slug."
        />
        <LabelledSelect label="Parent" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">— a root fibre —</option>
          {all
            .filter((n) => !n.removed_at)
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
        </LabelledSelect>
        <Field label="Legal fibre name" hint="Only for names that are legally binding under EU 1007/2011.">
          <Toggle checked={legal} onChange={setLegal} label={legal ? "Yes" : "No"} />
        </Field>
        <LabelledInput
          label="Tolerance (percentage points)"
          type="number"
          min={0}
          step="0.1"
          placeholder="leave empty to inherit"
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
          hint="Leave empty and this fibre inherits the nearest ancestor's tolerance — usually what you want."
        />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

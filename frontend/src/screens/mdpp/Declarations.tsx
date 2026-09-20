import { useMemo, useState } from "react";
import { usePrincipal } from "../../api/principal";
import { Button } from "../../design/Button";
import { Card, CardBody, CardHeader } from "../../design/Card";
import { Chip, Tag } from "../../design/Chip";
import { EmptyState } from "../../design/EmptyState";
import { Field, LabelledInput, LabelledSelect } from "../../design/Field";
import { Modal } from "../../design/Modal";
import { Notice } from "../../design/Notice";
import { DataTable, type Column } from "../../design/Table";
import { errorMessage, useAsync } from "../../hooks/useAsync";
import { useMdpp } from "../../mdpp/context";
import type { DeclarationListItem, Gs1Level } from "../../mdpp/types";
import { CompositionEditor, type CompositionRow, toComponents } from "./CompositionEditor";
import s from "./mdpp.module.css";

const LEVELS: Gs1Level[] = ["model", "variant", "batch", "item"];

export interface DeclarationsProps {
  /**
   * Pin the screen to ONE GS1 path. A host with a product in hand (dpp-app's
   * product detail) passes it; mdpp-app's own admin leaves it out and gets the
   * unscoped, searchable list. Scoping hides the search controls rather than
   * pre-filling them — the path is not the user's to change here.
   */
  pathScope?: string | null;
  /** The RBAC resource type declarations are gated on in the host's policy. */
  resourceType?: string;
}

export function Declarations({ pathScope = null, resourceType = "declarations" }: DeclarationsProps) {
  const mdpp = useMdpp();
  const { can } = usePrincipal();

  const [prefix, setPrefix] = useState("");
  const [level, setLevel] = useState<Gs1Level | "">("");
  const [currentOnly, setCurrentOnly] = useState(true);
  const [selected, setSelected] = useState<string | null>(pathScope);
  const [creating, setCreating] = useState(false);

  const effectivePrefix = pathScope ?? prefix;
  const list = useAsync(
    () =>
      mdpp.listDeclarations({
        pathPrefix: effectivePrefix || undefined,
        level: pathScope ? "" : level,
        currentOnly: pathScope ? false : currentOnly,
      }),
    [mdpp, effectivePrefix, level, currentOnly, pathScope],
  );

  const items = list.data?.items ?? [];
  const mayCreate = can(resourceType, "create");

  const columns: Column<DeclarationListItem>[] = useMemo(
    () => [
      ...(pathScope
        ? []
        : [
            {
              key: "path",
              header: "GS1 path",
              render: (d: DeclarationListItem) => (
                <div className={s.pathCell}>
                  <span className={s.path}>{d.gs1_path}</span>
                </div>
              ),
            } as Column<DeclarationListItem>,
            {
              key: "level",
              header: "Level",
              render: (d: DeclarationListItem) => (d.level ? <Tag>{d.level}</Tag> : <span className={s.sub}>—</span>),
            } as Column<DeclarationListItem>,
          ]),
      {
        key: "composition",
        header: "Declared composition",
        render: (d) => (
          <div className={s.slugs}>
            {d.components.length === 0 && <span className={s.sub}>none</span>}
            {d.components.map((c) => (
              <Chip key={c.slug}>
                {c.slug} {Number(c.percentage.toFixed(3))}%
              </Chip>
            ))}
          </div>
        ),
      },
      {
        key: "version",
        header: "Version",
        render: (d) => (
          <span className="mdpp-row" style={{ gap: 6 }}>
            v{d.version}
            {d.is_current && <Chip tone="ok" dot>current</Chip>}
            {d.withdrawn_at && <Chip tone="warn">withdrawn</Chip>}
          </span>
        ),
      },
      {
        key: "by",
        header: "Declared by",
        render: (d) => (
          <div className={s.pathCell}>
            <span>{d.declared_by_name ?? d.declared_by}</span>
            <span className={s.sub}>
              {d.reason}
              {d.declared_at ? ` · ${new Date(d.declared_at).toLocaleDateString()}` : ""}
            </span>
          </div>
        ),
      },
    ],
    [pathScope],
  );

  return (
    <>
      <Card>
        <CardHeader
          title={pathScope ? "Declarations" : "Declarations"}
          subtitle={
            pathScope
              ? `version history for ${pathScope}`
              : list.data
                ? `${items.length} shown · ${list.data.total} total`
                : undefined
          }
          actions={
            mayCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                {pathScope ? "New version" : "Declare composition"}
              </Button>
            )
          }
        />
        <CardBody>
          {!pathScope && (
            <div className={s.toolbar}>
              <div className={s.grow}>
                <LabelledInput
                  label="GS1 path starts with"
                  placeholder="01/08718036001015"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                />
              </div>
              <LabelledSelect label="Level" value={level} onChange={(e) => setLevel(e.target.value as Gs1Level | "")}>
                <option value="">Any level</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </LabelledSelect>
              <LabelledSelect
                label="Versions"
                value={currentOnly ? "current" : "all"}
                onChange={(e) => setCurrentOnly(e.target.value === "current")}
              >
                <option value="current">Current only</option>
                <option value="all">All versions</option>
              </LabelledSelect>
              {(prefix || level || !currentOnly) && (
                <Button size="sm" variant="ghost" onClick={() => { setPrefix(""); setLevel(""); setCurrentOnly(true); }}>
                  Clear filters
                </Button>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {list.error && <Notice tone="error">{list.error}</Notice>}

      <Card>
        <CardBody>
          <DataTable
            columns={columns}
            rows={items}
            rowKey={(d) => d.id}
            selectedKey={selected}
            onRowClick={pathScope ? undefined : (d) => setSelected(d.gs1_path)}
            empty={
              list.loading ? (
                <EmptyState title="Loading…" />
              ) : (
                <EmptyState
                  title="No declarations"
                  description={
                    effectivePrefix
                      ? "Nothing on this identifier yet."
                      : "Declared compositions appear here once an operator records one."
                  }
                />
              )
            }
          />
        </CardBody>
      </Card>

      {creating && (
        <NewVersionModal
          gs1Path={pathScope ?? selected ?? ""}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void list.reload(); }}
        />
      )}
    </>
  );
}

// ── new version ──────────────────────────────────────────────────────────

const REASONS = [
  { value: "initial", label: "Initial — the first declaration for this identifier" },
  { value: "correction", label: "Correction — the previous version was wrong" },
  { value: "spec_change", label: "Spec change — the product itself changed" },
  { value: "post_test", label: "Post-test — revised after a laboratory result" },
] as const;

function NewVersionModal({
  gs1Path,
  onClose,
  onSaved,
}: {
  /** Fixed when the screen is path-scoped; otherwise the starting value of an
   *  editable field, because there is no other way to make a FIRST declaration
   *  on a product that has none. */
  gs1Path: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const mdpp = useMdpp();
  const fibres = useAsync(() => mdpp.listFibreNodes(), [mdpp]);
  const [path, setPath] = useState(gs1Path);
  const pathFixed = Boolean(gs1Path);
  const [rows, setRows] = useState<CompositionRow[]>([{ fibre: "", percentage: "" }]);
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("initial");
  // Who declares is NOT a choice: it is the organisation you are acting for.
  // A picker of economic operators would offer options the service refuses,
  // because you may only declare as an organisation you represent.
  const { principal } = usePrincipal();
  const declaringOrg = principal?.organisation ?? null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const components = toComponents(rows);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await mdpp.createDeclarationVersion(path.trim(), { reason, components });
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="New declaration version"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || components.length === 0 || !declaringOrg || !path.trim()}>
            {saving ? "Saving…" : "Create version"}
          </Button>
        </>
      }
    >
      <div className={s.detailGrid}>
        <Notice tone="info">
          A declaration is never edited — this records a <strong>new version</strong> and makes it
          current. Earlier versions stay readable, and any test already taken is still compared
          against the version that was current when it was requested.
        </Notice>

        <LabelledInput
          label="GS1 path"
          value={path}
          readOnly={pathFixed}
          onChange={(e) => setPath(e.target.value)}
          placeholder="01/08718036001015/10/LOT-2026-BB-001"
          hint={pathFixed ? undefined : "The identifier this composition is declared for. A first declaration creates version 1."}
        />
        <Field label="Declared by">
          {declaringOrg ? (
            <div className={s.declaringOrg}>
              <strong>{declaringOrg.name}</strong>
              <span>
                the organisation you are acting for — switch organisation to declare as another
              </span>
            </div>
          ) : (
            <Notice tone="warn">
              You are not acting for an organisation, so there is nobody to declare this
              composition. Choose one in the “acting as” switcher.
            </Notice>
          )}
        </Field>
        <LabelledSelect label="Reason" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </LabelledSelect>

        <CompositionEditor rows={rows} onChange={setRows} fibres={fibres.data} disabled={saving} />

        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

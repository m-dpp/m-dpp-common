import { useEffect, useMemo, useState } from "react";
import { useApi } from "../api/context";
import { usePrincipal } from "../api/principal";
import type { Organisation, Role } from "../api/types";
import { AttrsEditor } from "../components/AttrsEditor/AttrsEditor";
import { attrsPatch } from "../components/attrsPatch";
import { RoleChips } from "../components/RoleChips";
import { Button } from "../design/Button";
import { Card, CardBody, CardFooter, CardHeader } from "../design/Card";
import { Chip, Tag } from "../design/Chip";
import { EmptyState } from "../design/EmptyState";
import { Field, Input, LabelledInput, Select } from "../design/Field";
import { Modal } from "../design/Modal";
import { Notice } from "../design/Notice";
import { DataTable } from "../design/Table";
import { Toggle } from "../design/Toggle";
import { errorMessage, useAsync } from "../hooks/useAsync";
import s from "./Organisations.module.css";

/** Identifier schemes an organisation may (optionally) carry, stored in `attrs[scheme]`. */
export const IDENTIFIER_SCHEMES = [
  { value: "gln", label: "GLN" },
  { value: "lei", label: "LEI" },
  { value: "did", label: "DID" },
] as const;
type Scheme = (typeof IDENTIFIER_SCHEMES)[number]["value"];
const SCHEME_KEYS: string[] = IDENTIFIER_SCHEMES.map((x) => x.value);

export function organisationIdentifier(org: Organisation): { scheme: Scheme; value: string } | null {
  const attrs = (org.attrs ?? {}) as Record<string, unknown>;
  for (const { value } of IDENTIFIER_SCHEMES) {
    const v = attrs[value];
    if (typeof v === "string" && v) return { scheme: value, value: v };
  }
  return null;
}

export interface OrganisationsProps {
  /** The resource type name the host's RBAC policy uses for organisations. */
  resourceType?: string;
  /** Preselect an organisation. */
  initialSelectedId?: string | null;
}

export function Organisations({ resourceType = "organisations", initialSelectedId = null }: OrganisationsProps) {
  const api = useApi();
  const { can, refresh: refreshPrincipal } = usePrincipal();
  const orgs = useAsync(() => api.listOrganisations({ includeRemoved: true }), [api]);
  const roles = useAsync(() => api.listRoles(), [api]);
  const orgRoles = useAsync(() => api.listOrganisationRoles(), [api]);
  const subjects = useAsync(() => api.listSubjects(), [api]);

  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(() => orgs.data?.find((o) => o.id === selectedId) ?? null, [orgs.data, selectedId]);
  const rolesOf = (orgId: string) => (orgRoles.data ?? []).filter((r) => r.organisation_id === orgId);
  const linkedUsers = (orgId: string) => (subjects.data ?? []).filter((x) => x.membership?.organisation?.id === orgId).length;

  const reloadAll = async () => {
    await Promise.all([orgs.reload(), orgRoles.reload(), subjects.reload()]);
    await refreshPrincipal();
  };

  const listError = orgs.error || roles.error || orgRoles.error;

  return (
    <div className={[s.grid, selected ? s.withDetail : ""].join(" ")}>
      <Card>
        <CardHeader
          title="Organisations"
          subtitle={orgs.data ? `${orgs.data.length}` : undefined}
          actions={
            can(resourceType, "create") && (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                ＋ New organisation
              </Button>
            )
          }
        />
        <CardBody flush>
          {listError && (
            <div style={{ padding: 12 }}>
              <Notice tone="error">{listError}</Notice>
            </div>
          )}
          <DataTable
            rows={orgs.data ?? []}
            rowKey={(o) => o.id}
            selectedKey={selectedId}
            onRowClick={(o) => setSelectedId(o.id === selectedId ? null : o.id)}
            empty={<EmptyState compact title={orgs.loading ? "Loading…" : "No organisations yet"} description="Create the parties of the supply chain: operators, laboratories, authorities, recyclers." />}
            columns={[
              {
                key: "name",
                header: "Name",
                render: (o) => (
                  <span className={["mdpp-row", o.removed_at ? s.inactive : ""].join(" ")}>
                    <strong>{o.name}</strong>
                    {o.removed_at && <Chip tone="warn">inactive</Chip>}
                  </span>
                ),
              },
              { key: "roles", header: "Roles", render: (o) => <RoleChips names={rolesOf(o.id).map((r) => r.role_name)} roles={roles.data} /> },
              {
                key: "identifier",
                header: "Identifier",
                render: (o) => {
                  const id = organisationIdentifier(o);
                  return id ? (
                    <span className="mdpp-row">
                      <Tag>{id.scheme.toUpperCase()}</Tag>
                      <code>{id.value}</code>
                    </span>
                  ) : (
                    <span className="mdpp-faint">none</span>
                  );
                },
              },
              { key: "users", header: "Linked users", align: "right", render: (o) => <span className="mdpp-muted">{linkedUsers(o.id)}</span> },
              {
                key: "action",
                header: "",
                align: "right",
                render: (o) => (
                  <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedId(o.id); }}>
                    Open
                  </Button>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>

      {selected && (
        <OrganisationDetail
          key={selected.id}
          org={selected}
          roles={roles.data ?? []}
          assignments={rolesOf(selected.id)}
          linkedUsers={linkedUsers(selected.id)}
          canUpdate={can(resourceType, "update")}
          canDelete={can(resourceType, "delete")}
          onClose={() => setSelectedId(null)}
          onChanged={reloadAll}
        />
      )}

      <CreateOrganisationModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={async (o) => {
          setCreating(false);
          await reloadAll();
          setSelectedId(o.id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- detail

interface DetailProps {
  org: Organisation;
  roles: Role[];
  assignments: { id: string; role_name: string }[];
  linkedUsers: number;
  canUpdate: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}

function OrganisationDetail({ org, roles, assignments, linkedUsers, canUpdate, canDelete, onClose, onChanged }: DetailProps) {
  const api = useApi();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const initialId = organisationIdentifier(org);
  const [scheme, setScheme] = useState<Scheme | "">(initialId?.scheme ?? "");
  const [identifier, setIdentifier] = useState(initialId?.value ?? "");
  const [attrs, setAttrs] = useState<Record<string, unknown>>((org.attrs ?? {}) as Record<string, unknown>);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [roleToAdd, setRoleToAdd] = useState("");

  useEffect(() => {
    if (!editing) {
      setName(org.name);
      const id = organisationIdentifier(org);
      setScheme(id?.scheme ?? "");
      setIdentifier(id?.value ?? "");
      setAttrs((org.attrs ?? {}) as Record<string, unknown>);
    }
  }, [org, editing]);

  const active = org.removed_at === null;
  const held = assignments.map((a) => a.role_name);
  const addable = roles.filter((r) => r.active && !held.includes(r.name));

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const next: Record<string, unknown> = { ...attrs };
      for (const k of SCHEME_KEYS) delete next[k];
      if (scheme && identifier.trim()) next[scheme] = identifier.trim();
      const patch = attrsPatch(org.attrs, next);
      const body: { name?: string; attrs?: Record<string, unknown> } = {};
      if (name.trim() && name.trim() !== org.name) body.name = name.trim();
      if (Object.keys(patch).length) body.attrs = patch;
      if (Object.keys(body).length) await api.updateOrganisation(org.id, body);
      setEditing(false);
      await onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={org.name}
        subtitle={active ? undefined : "inactive"}
        actions={
          <>
            {canUpdate && (
              <Toggle
                checked={active}
                disabled={busy}
                label={active ? "Active" : "Inactive"}
                onChange={(v) => run(() => api.updateOrganisation(org.id, { active: v }))}
                title="Deactivate hides the organisation from lists; it can be reactivated here."
              />
            )}
            {canUpdate && !editing && active && (
              <Button size="sm" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
              ×
            </Button>
          </>
        }
      />
      <CardBody className="mdpp-stack" style={{ gap: 18 }}>
        {err && <Notice tone="error">{err}</Notice>}

        {editing ? (
          <div className={s.form}>
            <LabelledInput label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
            <Field label="Identifier" hint="Optional. A laboratory may have none.">
              <div className={s.two}>
                <Select value={scheme} onChange={(e) => setScheme(e.target.value as Scheme | "")} options={[{ value: "", label: "none" }, ...IDENTIFIER_SCHEMES.map((x) => ({ value: x.value, label: x.label }))]} />
                <Input mono value={identifier} disabled={!scheme} placeholder={scheme === "gln" ? "13-digit GLN or 7–12 digit company prefix" : scheme === "lei" ? "20-character LEI" : scheme === "did" ? "did:method:…" : ""} onChange={(e) => setIdentifier(e.target.value)} />
              </div>
            </Field>
          </div>
        ) : (
          <div className={s.kv}>
            <span className={s.k}>Identifier</span>
            <span>
              {initialId ? (
                <span className="mdpp-row">
                  <Tag>{initialId.scheme.toUpperCase()}</Tag>
                  <code>{initialId.value}</code>
                </span>
              ) : (
                <span className="mdpp-faint">none</span>
              )}
            </span>
            <span className={s.k}>Linked users</span>
            <span>{linkedUsers}</span>
            <span className={s.k}>Internal id</span>
            <code className="mdpp-muted">{org.id}</code>
          </div>
        )}

        <div className={s.section}>
          <div className={s.sectionTitle}>Roles</div>
          <div className={s.roleRow}>
            {held.length === 0 && <span className="mdpp-faint">No roles — subjects representing this organisation resolve to the anonymous role.</span>}
            {assignments.map((a) => (
              <Tag key={a.id} onRemove={canUpdate && editing ? () => run(() => api.removeOrganisationRole(a.id)) : undefined} removeLabel={`Remove role ${a.role_name}`}>
                {roles.find((r) => r.name === a.role_name)?.label ?? a.role_name}
              </Tag>
            ))}
            {canUpdate && editing && addable.length > 0 && (
              <span className="mdpp-row">
                <Select size_="sm" value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value)} placeholder="Add role…" options={addable.map((r) => ({ value: r.name, label: r.label }))} />
                <Button size="sm" disabled={!roleToAdd || busy} onClick={() => run(() => api.addOrganisationRole(org.id, roleToAdd)).then(() => setRoleToAdd(""))}>
                  Add
                </Button>
              </span>
            )}
          </div>
          {editing && <span className="mdpp-xs mdpp-muted">Role changes apply immediately; they define what subjects of this organisation may do.</span>}
        </div>

        <div className={s.section}>
          <div className={s.sectionTitle}>Attributes</div>
          <AttrsEditor
            mode={editing ? "edit" : "view"}
            value={attrs}
            hiddenKeys={SCHEME_KEYS}
            onChange={(v) => setAttrs(v)}
            emptyText={editing ? "No attributes — add a field, object or list below." : "No attributes"}
          />
        </div>
      </CardBody>
      {editing && (
        <CardFooter>
          {canDelete && (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => run(() => api.removeOrganisation(org.id)).then(() => setEditing(false))} style={{ marginRight: "auto" }}>
              Deactivate
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={save}>
            Save
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- create

function CreateOrganisationModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (o: Organisation) => Promise<void> }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [scheme, setScheme] = useState<Scheme | "">("");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setScheme("");
      setIdentifier("");
      setErr(null);
    }
  }, [open]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const attrs: Record<string, unknown> = {};
      if (scheme && identifier.trim()) attrs[scheme] = identifier.trim();
      const o = await api.createOrganisation({ name: name.trim(), attrs: Object.keys(attrs).length ? attrs : null });
      await onCreated(o);
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New organisation"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      {err && <Notice tone="error">{err}</Notice>}
      <LabelledInput label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <Field label="Identifier" hint="Optional — assign roles and attributes after creating.">
        <div className={s.two}>
          <Select value={scheme} onChange={(e) => setScheme(e.target.value as Scheme | "")} options={[{ value: "", label: "none" }, ...IDENTIFIER_SCHEMES.map((x) => ({ value: x.value, label: x.label }))]} />
          <Input mono value={identifier} disabled={!scheme} onChange={(e) => setIdentifier(e.target.value)} />
        </div>
      </Field>
    </Modal>
  );
}

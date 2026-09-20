import { useEffect, useMemo, useState } from "react";
import { useApi } from "../api/context";
import { usePrincipal } from "../api/principal";
import type { AttrPermission, ResourceAction, ResourcePermission, Role } from "../api/types";
import { Button } from "../design/Button";
import { Card, CardBody, CardHeader } from "../design/Card";
import { Chip, Tag } from "../design/Chip";
import { EmptyState } from "../design/EmptyState";
import { LabelledInput, Select } from "../design/Field";
import { Modal } from "../design/Modal";
import { Notice } from "../design/Notice";
import { SegmentedControl } from "../design/SegmentedControl";
import { DataTable, Table } from "../design/Table";
import { Toggle } from "../design/Toggle";
import { errorMessage, useAsync } from "../hooks/useAsync";
import s from "./Rbac.module.css";

type Tab = "roles" | "attributes" | "resources";

export interface RbacProps {
  initialTab?: Tab;
  /** The resource type the host's policy uses for the access-control surface itself. */
  resourceType?: string;
}

/** Roles (dynamic data), attribute visibility per entity type, resource access. Every
 *  column here is rendered from the fetched roles — nothing is hardcoded. Reading the
 *  matrices needs `read` on `resourceType`; changing them needs `create`/`update`/`delete`. */
export function Rbac({ initialTab = "attributes", resourceType = "rbac" }: RbacProps) {
  const api = useApi();
  const { can } = usePrincipal();
  const [tab, setTab] = useState<Tab>(initialTab);
  const roles = useAsync(() => api.listRoles(), [api]);
  const activeRoles = useMemo(() => (roles.data ?? []).filter((r) => r.active), [roles.data]);

  if (!can(resourceType, "read")) {
    return (
      <Card>
        <CardBody>
          <EmptyState title="Access control is not visible to your roles" description={`Reading the access rules needs "read" on "${resourceType}". Switch to an administrator to manage them.`} />
        </CardBody>
      </Card>
    );
  }
  const perms = { create: can(resourceType, "create"), update: can(resourceType, "update"), delete: can(resourceType, "delete") };

  return (
    <>
      <div className={s.toolbar}>
        <SegmentedControl<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "attributes", label: "Attribute visibility" },
            { value: "resources", label: "Resource access" },
            { value: "roles", label: "Roles", count: roles.data?.length },
          ]}
        />
      </div>
      {roles.error && <Notice tone="error">{roles.error}</Notice>}
      {!perms.update && <Notice tone="info">Read-only: your roles may view these rules but not change them.</Notice>}
      {tab === "roles" && <RolesPanel roles={roles.data ?? []} onChanged={roles.reload} perms={perms} />}
      {tab === "attributes" && <AttributesPanel roles={activeRoles} perms={perms} />}
      {tab === "resources" && <ResourcesPanel roles={activeRoles} perms={perms} />}
    </>
  );
}

// ---------------------------------------------------------------- roles

type Perms = { create: boolean; update: boolean; delete: boolean };

function RolesPanel({ roles, onChanged, perms }: { roles: Role[]; onChanged: () => Promise<void>; perms: Perms }) {
  const api = useApi();
  const { refresh } = usePrincipal();
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(r: Role, active: boolean) {
    setErr(null);
    try {
      await api.updateRole(r.name, { active });
      await onChanged();
      await refresh();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Roles"
        subtitle="actor identities — access is defined in the matrices, not in the names"
        actions={
          perms.create && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              ＋ Add role
            </Button>
          )
        }
      />
      <CardBody flush>
        {err && (
          <div style={{ padding: 12 }}>
            <Notice tone="error">{err}</Notice>
          </div>
        )}
        <DataTable
          rows={roles}
          rowKey={(r) => r.name}
          empty={<EmptyState compact title="No roles" />}
          columns={[
            { key: "name", header: "Name", render: (r) => <Tag>{r.name}</Tag> },
            { key: "label", header: "Label", render: (r) => <strong>{r.label}</strong> },
            { key: "desc", header: "Description", render: (r) => <span className={s.desc}>{r.description}</span> },
            { key: "status", header: "Status", render: (r) => (r.active ? <Chip tone="ok" dot>active</Chip> : <Chip>inactive</Chip>) },
            {
              key: "toggle",
              header: "",
              align: "right",
              render: (r) => <Toggle checked={r.active} disabled={!perms.update} onChange={(v) => toggle(r, v)} label={r.active ? "Deactivate" : "Activate"} />,
            },
          ]}
        />
      </CardBody>
      <AddRoleModal open={adding} onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); await onChanged(); }} />
    </Card>
  );
}

function AddRoleModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => Promise<void> }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setLabel("");
      setDescription("");
      setErr(null);
    }
  }, [open]);
  const valid = /^[a-z][a-z0-9_]{1,63}$/.test(name);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.createRole({ name, label: label.trim() || undefined, description: description.trim() });
      await onAdded();
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
      title="Add role"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !valid} onClick={submit}>Add</Button>
        </>
      }
    >
      {err && <Notice tone="error">{err}</Notice>}
      <LabelledInput label="Name" mono value={name} onChange={(e) => setName(e.target.value.trim())} placeholder="snake_case" hint="Lowercase letters, digits, underscore. Permission rows are created with safe defaults (read, no write)." error={name && !valid ? "must be snake_case, 2–64 chars" : undefined} autoFocus />
      <LabelledInput label="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
      <LabelledInput label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
    </Modal>
  );
}

// ---------------------------------------------------------------- attribute visibility

type Access = "none" | "read" | "rw";
const toAccess = (p: AttrPermission): Access => (p.can_write ? "rw" : p.can_read ? "read" : "none");
const fromAccess = (a: Access) => ({ can_read: a !== "none", can_write: a === "rw" });

function AttributesPanel({ roles, perms }: { roles: Role[]; perms: Perms }) {
  const api = useApi();
  const { refresh } = usePrincipal();
  const entityTypes = useAsync(() => api.listEntityTypes(), [api]);
  const [entityType, setEntityType] = useState<string>("");
  useEffect(() => {
    if (!entityType && entityTypes.data?.length) setEntityType(entityTypes.data[0]);
  }, [entityTypes.data, entityType]);

  const attributes = useAsync(() => (entityType ? api.listAttributes(entityType) : Promise.resolve([])), [api, entityType]);
  const permissions = useAsync(() => (entityType ? api.listAttrPermissions(entityType) : Promise.resolve([])), [api, entityType]);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const permIndex = useMemo(() => {
    const m = new Map<string, AttrPermission>();
    for (const p of permissions.data ?? []) m.set(`${p.attr_key}::${p.role_name}`, p);
    return m;
  }, [permissions.data]);

  async function setAccess(p: AttrPermission, a: Access) {
    setErr(null);
    setBusyKey(p.id);
    try {
      const updated = await api.updateAttrPermission(p.id, fromAccess(a));
      permissions.setData((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
      await refresh();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function reloadAll() {
    await Promise.all([attributes.reload(), permissions.reload()]);
  }

  async function sync() {
    setErr(null);
    try {
      const r = await api.syncAttrs();
      await reloadAll();
      setErr(null);
      setInfo(`Sync: ${r.discovered} keys found in stored data, ${r.registered} newly registered, ${r.inserted} permission rows added.`);
    } catch (e) {
      setErr(errorMessage(e));
    }
  }
  const [info, setInfo] = useState<string | null>(null);

  async function removeAttr(id: string) {
    setErr(null);
    try {
      await api.deleteAttribute(id);
      await reloadAll();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Attribute visibility"
        subtitle="attribute × role — resolved inheritance is filtered by these rules"
        actions={
          <>
            {entityTypes.data && entityTypes.data.length > 0 && (
              <SegmentedControl size="sm" value={entityType} onChange={setEntityType} options={entityTypes.data.map((t) => ({ value: t, label: t }))} aria-label="Entity type" />
            )}
            {perms.create && (
              <Button size="sm" onClick={sync} title="Discover attribute keys from stored data (never deletes)">
                Sync from data
              </Button>
            )}
            {perms.create && (
              <Button size="sm" variant="primary" disabled={!entityType} onClick={() => setAdding(true)}>
                ＋ Add attribute
              </Button>
            )}
          </>
        }
      />
      <CardBody flush>
        {(err || info) && (
          <div style={{ padding: 12 }}>
            {err ? <Notice tone="error">{err}</Notice> : <Notice tone="ok">{info}</Notice>}
          </div>
        )}
        {roles.length === 0 ? (
          <EmptyState compact title="No active roles" description="Add or activate a role first — the columns of this matrix are the roles." />
        ) : (attributes.data ?? []).length === 0 ? (
          <EmptyState compact title={attributes.loading ? "Loading…" : `No attributes registered for ${entityType || "this entity type"}`} description="Register attributes manually (including computed ones that never appear in stored data), or sync them from the data." />
        ) : (
          <Table compact stickyHeader maxHeight="calc(100vh - 280px)" className={s.matrix}>
            <thead>
              <tr>
                <th>Attribute</th>
                {roles.map((r) => (
                  <th key={r.name} title={r.description}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(attributes.data ?? []).map((a) => (
                <tr key={a.id}>
                  <td>
                    <span className={s.attrKey}>
                      <span>{a.attr_key}</span>
                      <span className={s.origin} title={a.origin === "manual" ? "registered by an admin" : "discovered from stored data"}>
                        {a.origin}
                      </span>
                      {a.origin === "manual" && perms.delete && (
                        <button type="button" className={s.removeAttr} onClick={() => removeAttr(a.id)} aria-label={`Remove ${a.attr_key}`} title="Remove registration (manual attributes only)">
                          ×
                        </button>
                      )}
                    </span>
                    {a.description && <div className={s.desc}>{a.description}</div>}
                  </td>
                  {roles.map((r) => {
                    const p = permIndex.get(`${a.attr_key}::${r.name}`);
                    if (!p) return <td key={r.name} className={s.none}>—</td>;
                    const acc = toAccess(p);
                    return (
                      <td key={r.name}>
                        <Select
                          size_="sm"
                          className={[s.cell, s[acc]].join(" ")}
                          value={acc}
                          disabled={busyKey === p.id || !perms.update}
                          onChange={(e) => setAccess(p, e.target.value as Access)}
                          aria-label={`${a.attr_key} for ${r.label}`}
                          options={[
                            { value: "none", label: "none" },
                            { value: "read", label: "read" },
                            { value: "rw", label: "read / write" },
                          ]}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
      <AddAttributeModal open={adding} entityType={entityType} onClose={() => setAdding(false)} onAdded={async () => { setAdding(false); await reloadAll(); }} />
    </Card>
  );
}

function AddAttributeModal({ open, entityType, onClose, onAdded }: { open: boolean; entityType: string; onClose: () => void; onAdded: () => Promise<void> }) {
  const api = useApi();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setKey("");
      setDescription("");
      setErr(null);
    }
  }, [open]);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.createAttribute({ entity_type: entityType, attr_key: key.trim(), description: description.trim() });
      await onAdded();
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
      title={`Register attribute for ${entityType}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !key.trim()} onClick={submit}>Register</Button>
        </>
      }
    >
      {err && <Notice tone="error">{err}</Notice>}
      <LabelledInput label="Attribute key" mono value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. parent_gs1_path" hint="May be a computed attribute that never appears in stored data. Permission rows are created for every role (read, no write)." autoFocus />
      <LabelledInput label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
    </Modal>
  );
}

// ---------------------------------------------------------------- resource access

const ACTIONS: ResourceAction[] = ["list", "read", "create", "update", "delete"];

function ResourcesPanel({ roles, perms }: { roles: Role[]; perms: Perms }) {
  const api = useApi();
  const { refresh } = usePrincipal();
  const resPerms = useAsync(() => api.listResourcePermissions(), [api]);
  const [err, setErr] = useState<string | null>(null);
  const resourceTypes = useMemo(() => Array.from(new Set((resPerms.data ?? []).map((p) => p.resource_type))).sort(), [resPerms.data]);

  async function set(p: ResourcePermission, action: ResourceAction, v: boolean) {
    setErr(null);
    try {
      const updated = await api.updateResourcePermission(p.id, { [`can_${action}`]: v });
      resPerms.setData((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)));
      await refresh();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <div className="mdpp-stack" style={{ gap: 16 }}>
      {err && <Notice tone="error">{err}</Notice>}
      {resourceTypes.length === 0 && <Card><CardBody><EmptyState compact title={resPerms.loading ? "Loading…" : "No resource permissions"} /></CardBody></Card>}
      {resourceTypes.map((rt) => (
        <Card key={rt}>
          <CardHeader title={rt} subtitle="role × operation" />
          <CardBody flush>
            <Table compact stickyHeader maxHeight="calc(100vh - 280px)" className={s.matrix}>
              <thead>
                <tr>
                  <th>Role</th>
                  {ACTIONS.map((a) => (
                    <th key={a}>{a}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => {
                  const p = (resPerms.data ?? []).find((x) => x.resource_type === rt && x.role_name === r.name);
                  return (
                    <tr key={r.name}>
                      <td>
                        <strong>{r.label}</strong> <span className="mdpp-faint mdpp-xs">{r.name}</span>
                      </td>
                      {ACTIONS.map((a) => (
                        <td key={a}>
                          {p ? (
                            <label className={s.check}>
                              <input type="checkbox" checked={p[`can_${a}`]} disabled={!perms.update} onChange={(e) => set(p, a, e.target.checked)} aria-label={`${r.label} may ${a} ${rt}`} />
                            </label>
                          ) : (
                            <span className={s.none} title="no row: allowed (dev posture)">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

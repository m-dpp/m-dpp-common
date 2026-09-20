import { useEffect, useState } from "react";
import { useApi } from "../api/context";
import { usePrincipal } from "../api/principal";
import type { Subject } from "../api/types";
import { RoleChips } from "../components/RoleChips";
import { Button } from "../design/Button";
import { Card, CardBody, CardHeader } from "../design/Card";
import { Chip } from "../design/Chip";
import { EmptyState } from "../design/EmptyState";
import { Field, LabelledInput, LabelledSelect } from "../design/Field";
import { Modal } from "../design/Modal";
import { Notice } from "../design/Notice";
import { DataTable } from "../design/Table";
import { Toggle } from "../design/Toggle";
import { errorMessage, useAsync } from "../hooks/useAsync";
import s from "./UsersAndLinks.module.css";

/**
 * Subjects (identities) and the organisation each one represents. A subject
 * represents exactly one organisation; the organisation's roles are the subject's
 * authority. Subjects are entered by hand until a real identity provider exists.
 */
export interface UsersAndLinksProps {
  /** The resource type the host's policy uses for subjects and memberships. */
  resourceType?: string;
}

export function UsersAndLinks({ resourceType = "subjects" }: UsersAndLinksProps) {
  const api = useApi();
  const { refresh: refreshPrincipal, principal, can } = usePrincipal();
  const mayCreate = can(resourceType, "create");
  const mayDelete = can(resourceType, "delete");
  const subjects = useAsync(() => api.listSubjects(), [api]);
  const orgs = useAsync(() => api.listOrganisations(), [api]);
  const roles = useAsync(() => api.listRoles(), [api]);

  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState<Subject | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function changed() {
    await subjects.reload();
    await refreshPrincipal();
  }

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      await changed();
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  return (
    <>
      <Notice tone="dev">
        No identity provider is connected yet, so subjects are created here by hand. The <code>sub</code> is what a validated token will carry later; everything else about access stays the same.
      </Notice>
      <Card>
        <CardHeader
          title="Users & links"
          subtitle={subjects.data ? `${subjects.data.length} subjects` : undefined}
          actions={
            mayCreate && (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                ＋ New subject
              </Button>
            )
          }
        />
        <CardBody flush>
          {(err || subjects.error) && (
            <div style={{ padding: 12 }}>
              <Notice tone="error">{err ?? subjects.error}</Notice>
            </div>
          )}
          <DataTable
            rows={subjects.data ?? []}
            rowKey={(x) => x.id}
            empty={<EmptyState compact title={subjects.loading ? "Loading…" : "No subjects yet"} description="Create a subject, then link it to the organisation it represents." />}
            columns={[
              {
                key: "subject",
                header: "Subject",
                render: (x) => (
                  <div className={s.sub}>
                    <span className="mdpp-row">
                      <strong>{x.display_name || x.sub}</strong>
                      {principal?.sub === x.sub && <Chip tone="accent">acting</Chip>}
                    </span>
                    <span className={s.subId}>
                      {x.sub}
                      {x.email ? ` · ${x.email}` : ""}
                    </span>
                  </div>
                ),
              },
              {
                key: "org",
                header: "Member of",
                render: (x) =>
                  x.memberships.length === 0 ? (
                    <span className="mdpp-faint">not linked → anonymous</span>
                  ) : (
                    <div className={s.memberships}>
                      {x.memberships.map((m) => (
                        <span key={m.id} className={s.membership}>
                          <span>{m.organisation?.name ?? "—"}</span>
                          {m.is_org_admin && <Chip tone="accent" title="May manage this organisation">org admin</Chip>}
                          {mayDelete && (
                            <button
                              type="button"
                              className={s.unlink}
                              title={`Unlink from ${m.organisation?.name ?? "this organisation"}`}
                              onClick={() => run(() => api.deleteMembership(m.id))}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  ),
              },
              {
                key: "roles",
                header: "Roles, per organisation",
                render: (x) =>
                  x.memberships.length === 0 ? (
                    <span className="mdpp-faint">—</span>
                  ) : (
                    <div className={s.memberships}>
                      {x.memberships.map((m) => (
                        <span key={m.id} className={s.membership}>
                          <RoleChips
                            names={m.roles}
                            roles={roles.data}
                            emptyText="organisation has no roles"
                          />
                        </span>
                      ))}
                    </div>
                  ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                render: (x) =>
                  mayCreate || mayDelete ? (
                    <div className={s.actions}>
                      {mayCreate && (
                        <Button size="sm" onClick={() => setLinking(x)}>
                          {x.memberships.length ? "Add organisation" : "Link"}
                        </Button>
                      )}
                      {mayDelete && (
                        <Button size="sm" variant="danger" onClick={() => run(() => api.deleteSubject(x.id))} title="Delete subject">
                          Delete
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="mdpp-faint mdpp-xs">read-only</span>
                  ),
              },
            ]}
          />
        </CardBody>
      </Card>

      <CreateSubjectModal open={creating} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await changed(); }} />
      <LinkModal
        subject={linking}
        organisations={orgs.data ?? []}
        onClose={() => setLinking(null)}
        onDone={async () => { setLinking(null); await changed(); }}
      />
    </>
  );
}

function CreateSubjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => Promise<void> }) {
  const api = useApi();
  const [sub, setSub] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setSub("");
      setName("");
      setEmail("");
      setErr(null);
    }
  }, [open]);
  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api.createSubject({ sub: sub.trim(), display_name: name.trim() || null, email: email.trim() || null });
      await onCreated();
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
      title="New subject"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !sub.trim()} onClick={submit}>Create</Button>
        </>
      }
    >
      {err && <Notice tone="error">{err}</Notice>}
      <LabelledInput label="sub (subject identifier)" mono value={sub} onChange={(e) => setSub(e.target.value)} placeholder="e.g. alice@byborre.example or an OIDC sub" hint="Unique. This is what the identity provider will assert later." autoFocus />
      <LabelledInput label="Display name" value={name} onChange={(e) => setName(e.target.value)} />
      <LabelledInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
    </Modal>
  );
}

function LinkModal({ subject, organisations, onClose, onDone }: { subject: Subject | null; organisations: { id: string; name: string }[]; onClose: () => void; onDone: () => Promise<void> }) {
  const api = useApi();
  const [orgId, setOrgId] = useState("");
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setOrgId("");
    setIsOrgAdmin(false);
    setErr(null);
  }, [subject]);

  // Organisations this subject is NOT already a member of. Adding a membership
  // no longer replaces anything — a subject may act for several.
  const already = new Set((subject?.memberships ?? []).map((m) => m.organisation?.id));
  const available = organisations.filter((o) => !already.has(o.id));

  async function submit() {
    if (!subject) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createMembership(subject.id, orgId, isOrgAdmin);
      await onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={subject !== null}
      onClose={onClose}
      title={`Add an organisation for ${subject?.display_name || subject?.sub || ""}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !orgId} onClick={submit}>Add membership</Button>
        </>
      }
    >
      {err && <Notice tone="error">{err}</Notice>}
      <LabelledSelect
        label="Organisation"
        value={orgId}
        onChange={(e) => setOrgId(e.target.value)}
        placeholder="Choose…"
        options={available.map((o) => ({ value: o.id, label: o.name }))}
        hint="When acting for this organisation, the subject holds exactly its roles — never a mix of several."
      />
      <Field
        label="May administer this organisation"
        hint="Manage its members and edit its own record. Scoped to this organisation only; it is not a platform-wide power."
      >
        <Toggle checked={isOrgAdmin} onChange={setIsOrgAdmin} label={isOrgAdmin ? "Yes" : "No"} />
      </Field>
      {(subject?.memberships.length ?? 0) > 0 && (
        <Notice tone="info">
          This subject already acts for{" "}
          {subject!.memberships.map((m) => m.organisation?.name).filter(Boolean).join(", ")}. Adding
          another does not replace it — they choose which one they are acting for, one at a time.
        </Notice>
      )}
    </Modal>
  );
}

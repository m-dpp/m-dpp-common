import { Fragment, useEffect, useRef, useState } from "react";
import { usePrincipal } from "../../api/principal";
import { Comparison } from "../../components/Comparison/Comparison";
import { Button } from "../../design/Button";
import { Card, CardBody, CardHeader } from "../../design/Card";
import { Chip, Tag } from "../../design/Chip";
import { EmptyState } from "../../design/EmptyState";
import { LabelledInput, LabelledSelect } from "../../design/Field";
import { Modal } from "../../design/Modal";
import { Notice } from "../../design/Notice";
import { Table } from "../../design/Table";
import { errorMessage, useAsync } from "../../hooks/useAsync";
import { useOrganisationsWithRole } from "../../hooks/useOrganisationsWithRole";
import { useMdpp } from "../../mdpp/context";
import type { AnalysisType, ComparisonResponse, Gs1Level, TestListItem, TestStatus } from "../../mdpp/types";
import s from "./mdpp.module.css";

const LEVELS: Gs1Level[] = ["model", "variant", "batch", "item"];
const STATUSES: TestStatus[] = ["requested", "in_progress", "completed", "error"];

const STATUS_TONE: Record<TestStatus, "neutral" | "ok" | "warn" | "error"> = {
  requested: "neutral",
  in_progress: "neutral",
  completed: "ok",
  error: "error",
};

export interface TestsProps {
  /**
   * Pin the screen to ONE GS1 path — a host with a product in hand passes it;
   * mdpp-app's own admin leaves it out and gets the searchable list.
   */
  pathScope?: string | null;
  resourceType?: string;
  /** Hide the section chrome when the host supplies its own heading. */
  bare?: boolean;
  /** A note rendered beside each comparison (e.g. "inherited from the variant"). */
  comparisonNote?: React.ReactNode;
  /** The identifier whose declaration is EFFECTIVE for `pathScope` — an ancestor
   *  supplied by a host that knows the hierarchy. Without it a scoped test whose
   *  own identifier declares nothing expands to "nothing was declared", even
   *  when the host is showing an inherited claim right above it. Only applied to
   *  rows on `pathScope` itself: an unscoped listing spans identifiers that
   *  share no ancestor. */
  declarationPath?: string | null;
}

/**
 * Tests and their results, merged into one screen.
 *
 * A test and its result are the same thing at two moments in time, so splitting
 * them across two screens only makes someone navigate between them. A completed
 * row expands **in place** into the shared Comparison renderer; a pending or
 * errored row offers Refresh instead.
 */
export function Tests({ pathScope = null, resourceType = "tests", bare = false, comparisonNote, declarationPath = null }: TestsProps) {
  const mdpp = useMdpp();
  const { can, principal } = usePrincipal();

  const [prefix, setPrefix] = useState("");
  const [level, setLevel] = useState<Gs1Level | "">("");
  const [status, setStatus] = useState<TestStatus | "">("");
  const [lab, setLab] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [analysisType, setAnalysisType] = useState<AnalysisType | "">("");
  const [sort, setSort] = useState<"requested_at" | "-requested_at" | "analysed_at" | "-analysed_at">("-requested_at");
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<TestListItem | null>(null);

  const effectivePrefix = pathScope ?? prefix;
  const list = useAsync(
    () =>
      mdpp.listTests({
        pathPrefix: effectivePrefix || undefined,
        level: pathScope ? "" : level,
        status: status || undefined,
        laboratoryId: lab || undefined,
        requestedBy: pathScope ? undefined : requestedBy || undefined,
        analysisType: analysisType || undefined,
        includeWithdrawn,
        sort,
      }),
    [mdpp, effectivePrefix, level, status, lab, requestedBy, analysisType, includeWithdrawn, sort, pathScope],
  );
  // `laboratory_id` and `requested_by` are m-dpp-identity organisation ids,
  // which mdpp stores directly — one id per organisation, everywhere.
  const { organisations: labs } = useOrganisationsWithRole("laboratory");
  // who COMMISSIONED the test, as distinct from who ran it
  const { organisations: requesters } = useOrganisationsWithRole("economic_operator");

  // Open on the organisation you are acting for — same reasoning as the
  // Declarations screen, and applied on change rather than on every render so
  // clearing it sticks.
  const actingOrgId = principal?.organisation?.id ?? null;
  const commissions = (principal?.roles ?? []).includes("economic_operator");
  const appliedFor = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (appliedFor.current === actingOrgId) return;
    appliedFor.current = actingOrgId;
    setRequestedBy(commissions && actingOrgId ? actingOrgId : "");
  }, [actingOrgId, commissions]);

  const items = list.data?.items ?? [];
  const mayWrite = can(resourceType, "create");
  const mayWithdraw = can(resourceType, "delete");

  const refresh = async (t: TestListItem) => {
    setBusy(t.id);
    setActionError(null);
    try {
      await mdpp.refreshTest(t.gs1_path, t.id);
      await list.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const filtersActive = prefix || level || status || lab || requestedBy || analysisType || includeWithdrawn || sort !== "-requested_at";

  const body = (
    <>
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
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </LabelledSelect>
          <LabelledSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value as TestStatus | "")}>
            <option value="">Any status</option>
            {STATUSES.map((x) => <option key={x} value={x}>{x.replace("_", " ")}</option>)}
          </LabelledSelect>
          <LabelledSelect label="Requested by" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)}>
            <option value="">Any organisation</option>
            {requesters.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </LabelledSelect>
          <LabelledSelect label="Laboratory" value={lab} onChange={(e) => setLab(e.target.value)}>
            <option value="">Any laboratory</option>
            {labs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </LabelledSelect>
          <LabelledSelect
            label="Test type"
            value={analysisType}
            onChange={(e) => setAnalysisType(e.target.value as AnalysisType | "")}
          >
            <option value="">Any type</option>
            <option value="in_loco">in-loco</option>
            <option value="submitted_data">client-submitted</option>
          </LabelledSelect>
          <LabelledSelect
            label="Withdrawn"
            value={includeWithdrawn ? "show" : "hide"}
            onChange={(e) => setIncludeWithdrawn(e.target.value === "show")}
          >
            <option value="hide">Hide withdrawn</option>
            <option value="show">Show withdrawn</option>
          </LabelledSelect>
          <LabelledSelect label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="-requested_at">Requested, newest</option>
            <option value="requested_at">Requested, oldest</option>
            <option value="-analysed_at">Result, newest</option>
            <option value="analysed_at">Result, oldest</option>
          </LabelledSelect>
          {filtersActive && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setPrefix(""); setLevel(""); setStatus(""); setLab(""); setRequestedBy(""); setAnalysisType(""); setIncludeWithdrawn(false); setSort("-requested_at"); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {pathScope && (
        <div className={s.toolbar}>
          <span className={s.spacer} />
          <Button size="sm" variant="ghost" onClick={() => setIncludeWithdrawn((v) => !v)}>
            {includeWithdrawn ? "Hide withdrawn" : "Show withdrawn"}
          </Button>
        </div>
      )}

      {list.error && <Notice tone="error">{list.error}</Notice>}
      {actionError && <Notice tone="error">{actionError}</Notice>}

      <Table compact={Boolean(pathScope)}>
        <thead>
          <tr>
            {!pathScope && <th>GS1 path</th>}
            {!pathScope && <th>Level</th>}
            {!pathScope && <th>Requested by</th>}
            <th>Laboratory</th>
            <th>Type</th>
            {!pathScope && <th>Ticket</th>}
            <th>Requested</th>
            <th>Result</th>
            <th>Status</th>
            <th className={s.actionCol} />
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && (
            <tr>
              <td colSpan={pathScope ? 6 : 10}>
                {list.loading ? (
                  <EmptyState title="Loading…" />
                ) : (
                  <EmptyState
                    title="No tests"
                    description={
                      effectivePrefix
                        ? "No laboratory test has been registered on this identifier yet."
                        : "Registered laboratory tests appear here."
                    }
                  />
                )}
              </td>
            </tr>
          )}
          {items.map((t) => (
            <Fragment key={t.id}>
              <tr className={t.withdrawn_at ? s.withdrawnRow : undefined}>
                {!pathScope && <td><span className={s.path}>{t.gs1_path}</span></td>}
                {!pathScope && <td>{t.level ? <Tag>{t.level}</Tag> : <span className={s.sub}>—</span>}</td>}
                {!pathScope && <td>{t.requested_by_name ?? <span className={s.sub}>—</span>}</td>}
                <td>
                  {/* pinned to one product the panel is narrow, so the ticket
                      rides under the lab rather than claiming a column */}
                  <div className={s.pathCell}>
                    <span>{t.laboratory_name ?? t.laboratory_id}</span>
                    {pathScope && <span className={s.path}>{t.ticket_number}</span>}
                  </div>
                </td>
                <td>
                  {t.analysis_type
                    ? <Chip tone={t.analysis_type === "in_loco" ? "neutral" : "warn"}>
                        {t.analysis_type === "in_loco" ? "in-loco" : "submitted"}
                      </Chip>
                    : <span className={s.sub}>—</span>}
                </td>
                {!pathScope && <td><span className={s.path}>{t.ticket_number}</span></td>}
                <td className={s.sub}>{t.requested_at ? new Date(t.requested_at).toLocaleDateString() : "—"}</td>
                <td className={s.sub}>{t.analysed_at ? new Date(t.analysed_at).toLocaleDateString() : "—"}</td>
                <td>
                  <span className="mdpp-row" style={{ gap: 6 }}>
                    <Chip tone={STATUS_TONE[t.status]} dot>{t.status.replace("_", " ")}</Chip>
                    {t.verification_status && t.verification_status !== "verified" && (
                      <Chip tone="warn">{t.verification_status}</Chip>
                    )}
                  </span>
                  {t.status_message && <div className={s.sub}>{t.status_message}</div>}
                  {t.withdrawn_at && (
                    <div className={s.sub}>
                      <Chip tone="warn">withdrawn</Chip>{" "}
                      {t.withdrawn_reason ? `“${t.withdrawn_reason}”` : "no reason given"}
                    </div>
                  )}
                </td>
                <td className={s.actionCol}>
                  {t.status === "completed" ? (
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                      {expanded === t.id ? "Hide results" : "See results"}
                    </Button>
                  ) : (
                    mayWrite && (
                      <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void refresh(t)}>
                        {busy === t.id ? "Refreshing…" : "Refresh"}
                      </Button>
                    )
                  )}
                  {/* A test registered against the wrong ticket is polling a
                      result that was never about this product. Withdrawing is
                      how that is corrected — the row is kept, it just stops
                      counting as evidence. */}
                  {mayWithdraw && !t.withdrawn_at && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Withdraw this test"
                      onClick={() => setWithdrawing(t)}
                    >
                      Withdraw
                    </Button>
                  )}
                </td>
              </tr>
              {expanded === t.id && (
                <tr>
                  <td colSpan={pathScope ? 6 : 10} className={s.expando}>
                    <ResultPanel
                      test={t}
                      note={comparisonNote}
                      // only for rows on the scoped identifier — an unscoped
                      // listing spans identifiers that share no ancestor
                      declarationPath={pathScope && t.gs1_path === pathScope ? declarationPath : null}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </>
  );

  return (
    <>
      {bare ? (
        body
      ) : (
        <Card>
          <CardHeader
            title="Tests & results"
            subtitle={
              pathScope
                ? `on ${pathScope}`
                : list.data
                  ? `${items.length} shown · ${list.data.total} total`
                  : undefined
            }
            actions={mayWrite && (
              <Button size="sm" onClick={() => setRegistering(true)}>
                {pathScope ? "Register test here" : "Register a test"}
              </Button>
            )}
          />
          <CardBody>{body}</CardBody>
        </Card>
      )}

      {withdrawing && (
        <WithdrawTestModal
          test={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={async () => { setWithdrawing(null); await list.reload(); }}
        />
      )}

      {registering && (
        <RegisterTestModal
          gs1Path={pathScope ?? ""}
          labs={labs}
          onClose={() => setRegistering(false)}
          onSaved={() => { setRegistering(false); void list.reload(); }}
        />
      )}
    </>
  );
}

// ── the expanded result ──────────────────────────────────────────────────

/**
 * The comparison for this test's identifier, rendered by the shared component.
 *
 * mdpp answers per identifier, so the call returns every comparison on that
 * path; this narrows to the one test that was expanded. No verdict is computed
 * here — or anywhere outside mdpp-app.
 */
function ResultPanel({
  test,
  note,
  declarationPath,
}: {
  test: TestListItem;
  note?: React.ReactNode;
  declarationPath?: string | null;
}) {
  const mdpp = useMdpp();
  const cmp = useAsync<ComparisonResponse>(
    () => mdpp.comparison(test.gs1_path, { declarationPath: declarationPath ?? undefined }),
    [mdpp, test.gs1_path, declarationPath],
  );

  if (cmp.loading) return <div className={s.expandoEmpty}>Loading the comparison…</div>;
  if (cmp.error) return <Notice tone="error">{cmp.error}</Notice>;

  const mine = cmp.data?.comparisons.find((c) => c.test.id === test.id);
  if (!mine) {
    return (
      <div className={s.expandoEmpty}>
        {test.verification_status && test.verification_status !== "verified" ? (
          <>
            This result reports identifier <strong>{test.gs1_path}</strong> as{" "}
            <strong>{test.verification_status}</strong>, so it is not compared against the
            declaration — it is evidence about a different identifier.
          </>
        ) : (
          <>There is no declaration on this identifier to compare this result against.</>
        )}
      </div>
    );
  }
  return <Comparison comparison={mine} contextNote={note} />;
}

// ── withdraw ─────────────────────────────────────────────────────────────

/**
 * Withdrawing a test — the correction for "that was the wrong ticket".
 *
 * It is a **soft delete**: the row and any result already pulled are kept, and
 * simply stop being live evidence. Deleting outright would erase the fact that
 * a test was once registered and compared, which is the sort of thing a
 * passport exists to remember; a withdrawn test can also be explained, which a
 * missing one cannot.
 */
function WithdrawTestModal({
  test,
  onClose,
  onDone,
}: {
  test: TestListItem;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const mdpp = useMdpp();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await mdpp.withdrawTest(test.gs1_path, test.id, reason.trim() || undefined);
      await onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title="Withdraw this test"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={submit}>
            {busy ? "Withdrawing…" : "Withdraw test"}
          </Button>
        </>
      }
    >
      <div className={s.detailGrid}>
        <Notice tone="info">
          The test and any result it pulled are <strong>kept</strong> — they stop counting as
          evidence and disappear from comparisons, but the record that a test was registered
          remains. A withdrawn test can be explained; a deleted one cannot.
        </Notice>
        <div className={s.versionRow}>
          <span>
            <strong>{test.ticket_number}</strong>
            <span className={s.sub}> at {test.laboratory_name ?? test.laboratory_id}</span>
          </span>
          <Chip tone={test.status === "completed" ? "ok" : "neutral"}>{test.status.replace("_", " ")}</Chip>
        </div>
        <LabelledInput
          label="Reason"
          placeholder="wrong ticket"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Optional, and worth writing: “wrong ticket” and “sample lost” are different facts."
        />
        {err && <Notice tone="error">{err}</Notice>}
      </div>
    </Modal>
  );
}

// ── register ─────────────────────────────────────────────────────────────

export interface RegisterTestProps {
  /** The identifier the test is registered on. */
  gs1Path: string;
  /** Called after a successful registration. */
  onRegistered?: () => void | Promise<void>;
  label?: string;
  /** The RBAC resource type tests are gated on in the host's policy. */
  resourceType?: string;
}

/**
 * Just the "register a test" action — the button and its modal, without the
 * list. A host that already shows the tests (dpp-app's Molecular tab gathers
 * them per level) mounts this instead of a second copy of the table.
 */
export function RegisterTest({ gs1Path, onRegistered, label = "Register test here", resourceType = "tests" }: RegisterTestProps) {
  const { can } = usePrincipal();
  const [open, setOpen] = useState(false);
  const { organisations: labs } = useOrganisationsWithRole("laboratory");
  if (!can(resourceType, "create")) return null;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>{label}</Button>
      {open && (
        <RegisterTestModal
          gs1Path={gs1Path}
          labs={labs}
          onClose={() => setOpen(false)}
          onSaved={async () => { setOpen(false); await onRegistered?.(); }}
        />
      )}
    </>
  );
}

function RegisterTestModal({
  gs1Path,
  labs,
  onClose,
  onSaved,
}: {
  /** Fixed when the screen is path-scoped; otherwise the starting value of an
   *  editable field, so an admin can register against any identifier. */
  gs1Path: string;
  labs: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const mdpp = useMdpp();
  const [path, setPath] = useState(gs1Path);
  const pathFixed = Boolean(gs1Path);
  const [laboratoryId, setLaboratoryId] = useState("");
  const [ticket, setTicket] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await mdpp.registerTest(path.trim(), { laboratory_id: laboratoryId, ticket_number: ticket.trim() });
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
      title="Register a test"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !laboratoryId || !ticket.trim() || !path.trim()}>
            {saving ? "Registering…" : "Register test"}
          </Button>
        </>
      }
    >
      <div className={s.detailGrid}>
        <Notice tone="info">
          Registering a test records <strong>which lab holds which ticket</strong> for this
          identifier. Results are never entered here — they are pulled from the laboratory with
          that ticket, which is what makes them evidence rather than a claim.
        </Notice>
        <LabelledInput
          label="GS1 path"
          value={path}
          readOnly={pathFixed}
          onChange={(e) => setPath(e.target.value)}
          placeholder="01/08718036001015/10/LOT-2026-BB-001"
          hint={pathFixed ? undefined : "The identifier the laboratory analysed."}
        />
        <LabelledSelect label="Laboratory" value={laboratoryId} onChange={(e) => setLaboratoryId(e.target.value)}>
          <option value="">Select a laboratory…</option>
          {labs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </LabelledSelect>
        <LabelledInput
          label="Ticket"
          placeholder="SIM-OK-0001"
          value={ticket}
          onChange={(e) => setTicket(e.target.value)}
          hint="The lab's own reference. Unique per lab, not globally."
        />
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

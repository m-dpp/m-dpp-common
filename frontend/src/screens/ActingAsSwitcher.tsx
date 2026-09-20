import { useEffect } from "react";
import { useApi } from "../api/context";
import { useActingAs, useActingOrganisation } from "../api/identity";
import { usePrincipal } from "../api/principal";
import type { Role } from "../api/types";
import { Chip } from "../design/Chip";
import { Select } from "../design/Field";
import { useAsync } from "../hooks/useAsync";
import s from "./ActingAsSwitcher.module.css";

export interface ActingAsSwitcherProps {
  /** Role list for labels (fetched by the host, or omitted → raw role names). */
  roles?: Role[] | null;
}

/**
 * Two controls that look like one, because they answer two different questions.
 *
 * - **Acting as** — which known subject the UI is. A DEVELOPMENT affordance,
 *   visibly marked as temporary: real authentication replaces it.
 * - **On behalf of** — which of that subject's memberships is in force. This is
 *   NOT temporary. A user with several memberships must choose, and the choice
 *   decides both their authority and who owns anything they create. It only
 *   appears when there is an actual choice to make.
 *
 * Roles are never merged across memberships, so the chips below always show the
 * authority of exactly one organisation.
 */
export function ActingAsSwitcher({ roles }: ActingAsSwitcherProps) {
  const api = useApi();
  const [actingAs, setActingAs] = useActingAs();
  const [actingOrg, setActingOrg] = useActingOrganisation();
  const { principal, loading, error } = usePrincipal();
  const subjects = useAsync(() => api.listSubjects(), [api]);

  // memberships/roles may have changed elsewhere; refresh the list whenever the principal does
  useEffect(() => {
    void subjects.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal]);

  const label = (n: string) => roles?.find((r) => r.name === n)?.label ?? n;
  // anonymous *because* a choice is outstanding — not because there is no access
  const mustChoose = Boolean(principal?.anonymous) && (principal?.organisations?.length ?? 0) > 1;
  const who = principal?.subject?.display_name || principal?.subject?.sub || principal?.sub || "Anonymous";

  return (
    <div className={s.box} data-testid="acting-as">
      <div className={s.label}>
        <span>Acting as</span>
        <span className={s.temp}>dev only · temporary</span>
      </div>
      <Select
        size_="sm"
        value={actingAs ?? ""}
        onChange={(e) => setActingAs(e.target.value || null)}
        aria-label="Act as subject"
      >
        <option value="">— anonymous —</option>
        {(subjects.data ?? []).map((sub) => (
          <option key={sub.id} value={sub.sub}>
            {(sub.display_name || sub.sub) + (sub.membership?.organisation ? ` · ${sub.membership.organisation.name}` : " · not linked")}
          </option>
        ))}
      </Select>
      {/* Only shown when there is a choice: one membership needs no picker. */}
      {(principal?.organisations?.length ?? 0) > 1 && (
        <>
          <div className={s.label}>
            <span>On behalf of</span>
            {mustChoose && <span className={s.mustChoose}>choose one</span>}
          </div>
          <Select
            size_="sm"
            value={actingOrg ?? ""}
            onChange={(e) => setActingOrg(e.target.value || null)}
            aria-label="Act on behalf of organisation"
          >
            <option value="">— choose an organisation —</option>
            {(principal?.organisations ?? []).map((o) => (
              // prefer the cross-service key: this value is sent to EVERY API the
              // app talks to, and an id from one service is meaningless to another
              <option key={o.id} value={o.key ?? o.id}>
                {o.name}
                {o.is_org_admin ? "  (admin)" : ""}
              </option>
            ))}
          </Select>
        </>
      )}

      {/* Resolving to `public` because no organisation was picked looks exactly
          like having no access at all — so say which it is. */}
      {mustChoose && (
        <div className={s.notice}>
          This user acts for {principal?.organisations.length} organisations. Until one is
          chosen they have <strong>no authority</strong> and see only public data — roles are
          never merged across organisations.
        </div>
      )}

      <div className={s.who}>
        <div className={s.name}>{loading && !principal ? "Resolving…" : who}</div>
        {principal?.organisation ? (
          <div className={s.org}>
            acting for {principal.organisation.name}
            {principal.is_org_admin && <span className={s.orgAdmin}> · org admin</span>}
          </div>
        ) : (
          <div className={s.org}>no organisation</div>
        )}
        {principal?.reason && <div className={s.reason}>{principal.reason} → {principal.roles.map(label).join(", ")}</div>}
        {error && <div className={s.reason}>{error}</div>}
        <div className={s.roles}>
          {(principal?.roles ?? []).map((r) => (
            <Chip key={r} tone="accent" title={r}>
              {label(r)}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect } from "react";
import { useApi } from "../api/context";
import { useActingAs } from "../api/identity";
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
 * DEVELOPMENT affordance for the sidebar footer: pick which known subject the UI
 * acts as. Switching re-resolves the principal (organisation + roles) and the UI
 * adapts. This is not authentication and is visibly marked as temporary.
 */
export function ActingAsSwitcher({ roles }: ActingAsSwitcherProps) {
  const api = useApi();
  const [actingAs, setActingAs] = useActingAs();
  const { principal, loading, error } = usePrincipal();
  const subjects = useAsync(() => api.listSubjects(), [api]);

  // memberships/roles may have changed elsewhere; refresh the list whenever the principal does
  useEffect(() => {
    void subjects.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [principal]);

  const label = (n: string) => roles?.find((r) => r.name === n)?.label ?? n;
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
      <div className={s.who}>
        <div className={s.name}>{loading && !principal ? "Resolving…" : who}</div>
        {principal?.organisation ? (
          <div className={s.org}>represents {principal.organisation.name}</div>
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

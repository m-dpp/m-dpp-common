import { Chip } from "../design/Chip";
import type { Role } from "../api/types";

/** Role names as chips, labelled from the fetched role list (never a hardcoded list). */
export function RoleChips({ names, roles, emptyText = "—" }: { names: string[]; roles?: Role[] | null; emptyText?: string }) {
  if (!names.length) return <span className="mdpp-faint">{emptyText}</span>;
  const label = (n: string) => roles?.find((r) => r.name === n)?.label ?? n;
  return (
    <span className="mdpp-row mdpp-wrap" style={{ gap: 4 }}>
      {names.map((n) => (
        <Chip key={n} title={n}>
          {label(n)}
        </Chip>
      ))}
    </span>
  );
}

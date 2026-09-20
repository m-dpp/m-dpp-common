import { useMemo } from "react";
import { Button } from "../../design/Button";
import { Chip } from "../../design/Chip";
import { Input, Select } from "../../design/Field";
import type { FibreNode } from "../../mdpp/types";
import s from "./mdpp.module.css";

/**
 * Declared composition as fibre + percentage rows — never raw JSON.
 *
 * A declaration is a legal claim about a product, so the editor names the fibres
 * from the taxonomy rather than letting anyone type a slug that does not exist:
 * an unknown slug is rejected by the API anyway, and finding that out after
 * submitting is a worse way to learn it.
 *
 * The percentage total is shown but NOT enforced. Compositions legitimately fall
 * short of 100 (unlisted trims, "other fibres"), and refusing to record what
 * someone actually declares would make the passport less truthful, not more.
 */
export interface CompositionRow {
  fibre: string;
  percentage: string;
}

export interface CompositionEditorProps {
  rows: CompositionRow[];
  onChange: (rows: CompositionRow[]) => void;
  /** The taxonomy, for the fibre picker. */
  fibres: FibreNode[] | null;
  disabled?: boolean;
}

export function CompositionEditor({ rows, onChange, fibres, disabled }: CompositionEditorProps) {
  const options = useMemo(
    () => [...(fibres ?? [])].sort((a, b) => a.label.localeCompare(b.label)),
    [fibres],
  );

  const total = rows.reduce((sum, r) => {
    const n = Number.parseFloat(r.percentage);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const set = (i: number, patch: Partial<CompositionRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className={s.composition}>
      {rows.map((row, i) => (
        <div key={i} className={s.compositionRow}>
          <Select
            value={row.fibre}
            disabled={disabled}
            onChange={(e) => set(i, { fibre: e.target.value })}
            aria-label={`Fibre ${i + 1}`}
          >
            <option value="">Select a fibre…</option>
            {options.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.label}
                {f.legal_name ? "  (legal name)" : ""}
              </option>
            ))}
          </Select>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.001"
            value={row.percentage}
            disabled={disabled}
            onChange={(e) => set(i, { percentage: e.target.value })}
            aria-label={`Percentage ${i + 1}`}
          />
          <span className={s.pct}>%</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || rows.length === 1}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            aria-label={`Remove fibre ${i + 1}`}
          >
            Remove
          </Button>
        </div>
      ))}

      <div className={s.compositionFoot}>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange([...rows, { fibre: "", percentage: "" }])}>
          Add fibre
        </Button>
        <span className={s.total}>
          total{" "}
          <Chip tone={Math.abs(total - 100) < 0.001 ? "ok" : "neutral"}>
            {Number(total.toFixed(3))}%
          </Chip>
        </span>
      </div>
    </div>
  );
}

/** Rows → the API's component list. Blank rows are dropped, not sent as errors. */
export function toComponents(rows: CompositionRow[]): { fibre: string; percentage: number }[] {
  return rows
    .filter((r) => r.fibre && r.percentage !== "")
    .map((r) => ({ fibre: r.fibre, percentage: Number.parseFloat(r.percentage) }))
    .filter((c) => Number.isFinite(c.percentage));
}

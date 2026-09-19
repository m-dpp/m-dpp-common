import { ReactNode } from "react";
import s from "./SegmentedControl.module.css";

export interface SegmentOption<V extends string = string> {
  value: V;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string = string> {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
  "aria-label"?: string;
}

export function SegmentedControl<V extends string = string>({ options, value, onChange, size = "md", ...aria }: SegmentedControlProps<V>) {
  return (
    <div className={[s.seg, size === "sm" ? s.sm : ""].join(" ")} role="tablist" aria-label={aria["aria-label"]}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={[s.opt, o.value === value ? s.active : ""].join(" ")}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className={s.count}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

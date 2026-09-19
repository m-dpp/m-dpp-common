import { ReactNode } from "react";
import s from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Toggle({ checked, onChange, label, disabled, title }: ToggleProps) {
  return (
    <label className={[s.wrap, checked ? s.on : ""].join(" ")} aria-disabled={disabled || undefined} title={title}>
      <input
        className={s.input}
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={s.track}>
        <span className={s.knob} />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

import { HTMLAttributes, ReactNode } from "react";
import s from "./Chip.module.css";

export type ChipTone = "neutral" | "ok" | "warn" | "error" | "accent";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  dot?: boolean;
}

/** Rounded status/label pill. Colour is for *meaning* only — default is neutral. */
export function Chip({ tone = "neutral", dot, className, children, ...rest }: ChipProps) {
  const cls = [s.chip, tone !== "neutral" ? s[tone] : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} {...rest}>
      {dot && <span className={s.dot} />}
      {children}
    </span>
  );
}

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  removeLabel?: string;
  children: ReactNode;
}

/** Square monospace tag for identifiers, keys, role names. */
export function Tag({ onRemove, removeLabel = "Remove", className, children, ...rest }: TagProps) {
  return (
    <span className={[s.tag, className ?? ""].join(" ")} {...rest}>
      {children}
      {onRemove && (
        <button type="button" className={s.tagRemove} onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          ×
        </button>
      )}
    </span>
  );
}

import { ReactNode, useCallback, useState } from "react";
import s from "./Disclosure.module.css";

export interface DisclosureProps {
  title: ReactNode;
  /** Shown as a count next to the title, so a folded section still says how much it holds. */
  count?: number;
  /** Right-aligned extras in the header (status, buttons). Clicks there do not toggle. */
  actions?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}

/** A titled section that folds. Controlled: pair it with `useDisclosure` to remember the state. */
export function Disclosure({ title, count, actions, open, onToggle, children, className }: DisclosureProps) {
  return (
    <section className={[s.wrap, className ?? ""].join(" ")}>
      <div className={s.head}>
        <button type="button" className={s.toggle} onClick={onToggle} aria-expanded={open}>
          <span className={s.caret} aria-hidden>{open ? "▼" : "▶"}</span>
          <span className={s.title}>{title}</span>
          {count !== undefined && <span className={s.count}>{count}</span>}
        </button>
        {actions && <span className={s.actions}>{actions}</span>}
      </div>
      {open && <div className={s.body}>{children}</div>}
    </section>
  );
}

/**
 * Open/closed state for a Disclosure, remembered in this browser under `storageKey`
 * (a per-viewer convenience: it never leaves the browser and may be unavailable,
 * in which case the default applies and nothing is remembered).
 */
export function useDisclosure(storageKey: string, defaultOpen = true): { open: boolean; toggle: () => void } {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      try {
        window.localStorage.setItem(storageKey, next ? "1" : "0");
      } catch {
        /* not remembered */
      }
      return next;
    });
  }, [storageKey]);
  return { open, toggle };
}

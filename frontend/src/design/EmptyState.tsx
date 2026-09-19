import { ReactNode } from "react";
import s from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, description, action, compact }: EmptyStateProps) {
  return (
    <div className={[s.empty, compact ? s.compact : ""].join(" ")}>
      <div className={s.title}>{title}</div>
      {description && <div className={s.desc}>{description}</div>}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}

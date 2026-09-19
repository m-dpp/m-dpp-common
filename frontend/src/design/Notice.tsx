import { HTMLAttributes } from "react";
import s from "./Notice.module.css";

export type NoticeTone = "info" | "ok" | "warn" | "error" | "dev";

/** Inline message. `dev` is the dashed amber style reserved for development-only affordances. */
export function Notice({ tone = "info", className, ...rest }: HTMLAttributes<HTMLDivElement> & { tone?: NoticeTone }) {
  return <div role={tone === "error" ? "alert" : undefined} className={[s.notice, s[tone], className ?? ""].join(" ")} {...rest} />;
}

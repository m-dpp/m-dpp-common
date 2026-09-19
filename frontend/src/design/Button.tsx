import { ButtonHTMLAttributes, forwardRef } from "react";
import s from "./Button.module.css";

export type ButtonVariant = "primary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Square, icon-only button. */
  icon?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "outline", size = "md", block, icon, className, type = "button", ...rest },
  ref,
) {
  const cls = [s.btn, s[variant], size !== "md" ? s[size] : "", block ? s.block : "", icon ? s.icon : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <button ref={ref} type={type} className={cls} {...rest} />;
});

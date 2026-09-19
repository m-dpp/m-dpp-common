import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from "react";
import s from "./Field.module.css";

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/** Label + control + hint/error wrapper. */
export function Field({ label, hint, error, htmlFor, children, className }: FieldProps) {
  return (
    <div className={[s.field, className ?? ""].join(" ")}>
      {label && (
        <label className={s.label} htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? <span className={s.error}>{error}</span> : hint ? <span className={s.hint}>{hint}</span> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  size_?: "sm" | "md";
  mono?: boolean;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size_ = "md", mono, invalid, className, ...rest },
  ref,
) {
  const cls = [s.control, size_ === "sm" ? s.sm : "", mono ? s.mono : "", className ?? ""].filter(Boolean).join(" ");
  return <input ref={ref} className={cls} aria-invalid={invalid || undefined} {...rest} />;
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={[s.control, s.textarea, className ?? ""].join(" ")} aria-invalid={invalid || undefined} {...rest} />;
});

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options?: SelectOption[];
  placeholder?: string;
  size_?: "sm" | "md";
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, size_ = "md", invalid, className, children, ...rest },
  ref,
) {
  const cls = [s.control, s.select, size_ === "sm" ? s.sm : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <select ref={ref} className={cls} aria-invalid={invalid || undefined} {...rest}>
      {placeholder !== undefined && (
        <option value="" disabled={rest.required}>
          {placeholder}
        </option>
      )}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
});

/** Convenience: a labelled input with a generated id. */
export function LabelledInput({ label, hint, error, ...input }: InputProps & Pick<FieldProps, "label" | "hint" | "error">) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Input id={id} invalid={!!error} {...input} />
    </Field>
  );
}

export function LabelledSelect({ label, hint, error, ...select }: SelectProps & Pick<FieldProps, "label" | "hint" | "error">) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} htmlFor={id}>
      <Select id={id} invalid={!!error} {...select} />
    </Field>
  );
}

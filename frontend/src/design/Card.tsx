import { HTMLAttributes, ReactNode } from "react";
import s from "./Card.module.css";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[s.card, className ?? ""].join(" ")} {...rest} />;
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function CardHeader({ title, subtitle, actions }: CardHeaderProps) {
  return (
    <div className={s.header}>
      <div className={s.title}>
        <span className="mdpp-truncate">{title}</span>
        {subtitle && <span className={s.subtitle}>{subtitle}</span>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </div>
  );
}

export function CardBody({ flush, className, ...rest }: HTMLAttributes<HTMLDivElement> & { flush?: boolean }) {
  return <div className={[s.body, flush ? s.flush : "", className ?? ""].join(" ")} {...rest} />;
}

export function CardFooter(props: HTMLAttributes<HTMLDivElement>) {
  return <div className={s.footer} {...props} />;
}

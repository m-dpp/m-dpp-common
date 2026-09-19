import { ReactNode } from "react";
import s from "./AppShell.module.css";

export interface NavItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  /** Optional href for real links (the host may intercept clicks via onNavigate). */
  href?: string;
}

export interface NavGroup {
  label?: ReactNode;
  items: NavItem[];
}

export interface AppShellProps {
  brand: { name: ReactNode; subtitle?: ReactNode; mark?: ReactNode };
  nav: NavGroup[];
  activeKey?: string;
  onNavigate?: (key: string, item: NavItem) => void;
  /** Sticky header: title + optional subtitle and right-side actions. */
  title?: ReactNode;
  subtitle?: ReactNode;
  headerActions?: ReactNode;
  /** Sidebar footer — where the current user / acting-as switcher lives. */
  sidebarFooter?: ReactNode;
  children: ReactNode;
}

/** Sidebar (grouped nav + active state) + sticky header + content area. Router-agnostic. */
export function AppShell({ brand, nav, activeKey, onNavigate, title, subtitle, headerActions, sidebarFooter, children }: AppShellProps) {
  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.brand}>
          <div className={s.mark}>{brand.mark ?? "DP"}</div>
          <div>
            <div className={s.brandName}>{brand.name}</div>
            {brand.subtitle && <div className={s.brandSub}>{brand.subtitle}</div>}
          </div>
        </div>
        <nav className={s.nav}>
          {nav.map((g, gi) => (
            <div key={gi} className={s.group}>
              {g.label && <div className={s.groupLabel}>{g.label}</div>}
              {g.items.map((it) => {
                const cls = [s.item, it.key === activeKey ? s.active : ""].join(" ");
                const inner = (
                  <>
                    {it.icon && <span className={s.icon}>{it.icon}</span>}
                    <span className="mdpp-truncate">{it.label}</span>
                    {it.badge !== undefined && <span className={s.badge}>{it.badge}</span>}
                  </>
                );
                return it.href ? (
                  <a
                    key={it.key}
                    href={it.href}
                    className={cls}
                    aria-current={it.key === activeKey ? "page" : undefined}
                    onClick={(e) => {
                      if (onNavigate) {
                        e.preventDefault();
                        onNavigate(it.key, it);
                      }
                    }}
                  >
                    {inner}
                  </a>
                ) : (
                  <button key={it.key} type="button" className={cls} aria-current={it.key === activeKey ? "page" : undefined} onClick={() => onNavigate?.(it.key, it)}>
                    {inner}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        {sidebarFooter && <div className={s.footer}>{sidebarFooter}</div>}
      </aside>
      <div className={s.main}>
        <header className={s.header}>
          <div className={s.headerTitle}>
            {title && <h1 className="mdpp-truncate">{title}</h1>}
            {subtitle && <span className={s.headerSub}>{subtitle}</span>}
          </div>
          {headerActions && <div className={s.headerRight}>{headerActions}</div>}
        </header>
        <main className={s.content}>{children}</main>
      </div>
    </div>
  );
}

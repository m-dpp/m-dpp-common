import { ReactNode, TableHTMLAttributes } from "react";
import s from "./Table.module.css";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Keep the header row visible while the body scrolls. Needs `maxHeight`,
   *  which is what gives the header something to stick to. */
  stickyHeader?: boolean;
  /** Cap the table's height so it scrolls inside its own box rather than
   *  growing the page. Any CSS length. */
  maxHeight?: string | number;
  hover?: boolean;
  clickable?: boolean;
  compact?: boolean;
}

/** A plain styled table. Compose with <thead>/<tbody>, or use the `Column` helper below. */
export function Table({ hover = true, clickable, compact, stickyHeader, maxHeight, className, children, ...rest }: TableProps) {
  const cls = [
    s.table,
    hover ? s.hover : "",
    clickable ? s.clickable : "",
    compact ? s.compact : "",
    stickyHeader ? s.stickyHead : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const wrapCls = [s.wrap, maxHeight ? s.scrollBox : ""].filter(Boolean).join(" ");
  return (
    <div className={wrapCls} style={maxHeight ? { maxHeight } : undefined}>
      <table className={cls} {...rest}>
        {children}
      </table>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  width?: string | number;
}

export interface DataTableProps<T> extends Omit<TableProps, "children"> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, selectedKey, empty, ...table }: DataTableProps<T>) {
  return (
    <Table clickable={!!onRowClick} {...table}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={c.align === "right" ? s.right : c.align === "center" ? s.center : undefined} style={{ width: c.width }}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && empty !== undefined ? (
          <tr>
            <td colSpan={columns.length}>{empty}</td>
          </tr>
        ) : (
          rows.map((r) => {
            const k = rowKey(r);
            return (
              <tr key={k} className={selectedKey === k ? s.selected : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.align === "right" ? s.right : c.align === "center" ? s.center : undefined}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            );
          })
        )}
      </tbody>
    </Table>
  );
}

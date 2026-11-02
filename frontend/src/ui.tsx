import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  Inbox,
  CircleCheck,
  AlertCircle,
  Clock3,
  HelpCircle,
  LoaderCircle,
} from "lucide-react";
import type { ObligationStatus } from "./types";

export const formatKm = (value: number) =>
  new Intl.NumberFormat("es-AR").format(value);
export const formatMoney = (value: string | number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("es-AR", {
        style: "currency",
        currency: "ARS",
        maximumFractionDigits: 2,
      }).format(Number(value));
export function formatDate(value: string | null | undefined, withTime = false) {
  if (!value) return "Sin definir";
  const date = new Date(
    value.length === 10 ? `${value}T12:00:00-03:00` : value,
  );
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(date);
}
export function localInput(value?: string) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const p = (t: string) => parts.find((v) => v.type === t)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className={`field ${error ? "has-error" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="error-text" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}
export function EmptyState({
  title,
  description,
  children,
  icon,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon || <Inbox size={28} />}</span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={24} />
      <div>
        <strong>No pudimos cargar esta información</strong>
        <p>{message}</p>
      </div>
      <button className="button secondary" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}
const statusInfo = {
  OVERDUE: { label: "Vencido", Icon: AlertCircle, css: "danger" },
  UPCOMING: { label: "Por vencer", Icon: Clock3, css: "warning" },
  OK: { label: "Al día", Icon: CircleCheck, css: "success" },
  UNCONFIGURED: { label: "Sin configurar", Icon: HelpCircle, css: "neutral" },
};
export function StatusBadge({ status }: { status: ObligationStatus | string }) {
  const s = statusInfo[status as ObligationStatus] || {
    label: status,
    Icon: HelpCircle,
    css: "neutral",
  };
  return (
    <span className={`badge ${s.css}`}>
      <s.Icon size={14} />
      {s.label}
    </span>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  dismissible = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape" && dismissible) closeRef.current();
      if (e.key === "Tab") {
        const list = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          {dismissible && (
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X size={22} />
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

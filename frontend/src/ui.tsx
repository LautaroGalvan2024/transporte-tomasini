import {
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  Inbox,
  CircleCheck,
  AlertCircle,
  Clock3,
  HelpCircle,
  Eye,
  EyeOff,
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
export function PasswordField({
  label,
  hint,
  error,
  ...input
}: Omit<ComponentProps<"input">, "type" | "id"> & {
  label: string;
  hint?: string;
  error?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const description = error || hint;
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label className="field-label" htmlFor={id} id={`${id}-label`}>
        {label}
      </label>
      <span className="password-field">
        <input
          {...input}
          id={id}
          type={visible ? "text" : "password"}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={description ? `${id}-description` : undefined}
        />
        <button
          type="button"
          disabled={input.disabled}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-describedby={`${id}-label`}
          aria-controls={id}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? (
            <EyeOff size={20} aria-hidden="true" />
          ) : (
            <Eye size={20} aria-hidden="true" />
          )}
        </button>
      </span>
      {description && (
        <span
          id={`${id}-description`}
          className={error ? "error-text" : "field-hint"}
          role={error ? "alert" : undefined}
        >
          {description}
        </span>
      )}
    </div>
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
export { Modal } from "./app/Modal";

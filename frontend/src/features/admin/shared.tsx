import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Gauge,
  RefreshCw,
  Truck as TruckIcon,
  UserRound,
} from "lucide-react";
import { ApiError } from "../../api";
import type { Obligation } from "../../types";
import { useData } from "../../useData";
import { useViewportRows } from "../../useDesktopRows";
import { formatKm } from "../../ui";
import { dateLabel, err } from "./formatting";

export function useLoad<T>(path: string) {
  const {data, error, loading, refresh} = useData<T>(path, {abortOnUnmount: true, messageOf: err});
  return {data, error, loading, reload: refresh};
}

export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page-heading admin-page-heading">
      <h1>{title}</h1>
      {action}
    </header>
  );
}

export function usePageSize(reserved = 340, rowHeight = 76) {
  return useViewportRows(reserved, rowHeight, "admin");
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  busy = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <footer className="admin-pagination">
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total}`
          : "0 registros"}
      </span>
      <div>
        <button
          className="button ghost"
          aria-label="Página anterior"
          disabled={page <= 1 || busy}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="button ghost"
          aria-label="Página siguiente"
          disabled={page >= pages || busy}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </footer>
  );
}

export function usePagination<T>(items: T[], pageSize: number, resetKey = "") {
  const [page, setPage] = useState(1);
  const safePage = Math.min(
    page,
    Math.max(1, Math.ceil(items.length / pageSize)),
  );
  useEffect(() => setPage(1), [resetKey, pageSize]);
  return {
    page: safePage,
    setPage,
    items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}

export function LoadState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: string;
  retry: () => void;
}) {
  if (error)
    return (
      <div className="panel admin-load-error" role="alert">
        <CircleAlert size={24} />
        <div>
          <strong>No pudimos cargar la información</strong>
          <p>{error}</p>
        </div>
        <button type="button" className="button secondary" onClick={retry}>
          <RefreshCw size={18} />
          Reintentar
        </button>
      </div>
    );
  if (loading)
    return (
      <div className="admin-loading" role="status" aria-live="polite">
        <span className="admin-loading-line" />
        <span className="admin-loading-line short" />
        <p>Cargando la información…</p>
      </div>
    );
  return null;
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <div className="form-error" role="alert">
      <CircleAlert size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}

export function useFormStatus() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  return {
    busy,
    setBusy,
    message,
    fields,
    clear: () => {
      setMessage("");
      setFields({});
      setBusy(false);
    },
    begin: () => {
      setBusy(true);
      setMessage("");
      setFields({});
    },
    fail: (error: unknown) => {
      setMessage(err(error));
      setFields(error instanceof ApiError ? error.fields : {});
      setBusy(false);
    },
  };
}

export function FormFooter({
  busy,
  onClose,
  label = "Guardar cambios",
}: {
  busy: boolean;
  onClose: () => void;
  label?: string;
}) {
  return (
    <div className="admin-form-footer">
      <button
        type="button"
        className="button secondary"
        onClick={onClose}
        disabled={busy}
      >
        Cancelar
      </button>
      <button className="button primary" disabled={busy}>
        {busy ? "Guardando…" : label}
        {!busy && <Check size={18} />}
      </button>
    </div>
  );
}

export function OwnerLabel({ obligation }: { obligation: Obligation }) {
  return (
    <span className="admin-owner">
      {obligation.truckId || obligation.trailerId ? (
        <TruckIcon size={15} />
      ) : (
        <UserRound size={15} />
      )}
      {obligation.trailerId ? "Acoplado · " : ""}
      {obligation.truck?.plate ||
        obligation.trailer?.plate ||
        obligation.driver?.name ||
        "Sin asignación"}
    </span>
  );
}

export function DueSummary({ obligation }: { obligation: Obligation }) {
  return (
    <div className="admin-due-values">
      {obligation.dueDate && (
        <span>
          <CalendarDays size={15} />
          {dateLabel(obligation.dueDate)}
        </span>
      )}
      {obligation.dueKm !== null && (
        <span>
          <Gauge size={15} />
          {formatKm(obligation.dueKm)} km
        </span>
      )}
      {!obligation.dueDate && obligation.dueKm === null && (
        <span>Próximo límite sin definir</span>
      )}
      {obligation.odometerMissing && <small>Falta informar kilometraje</small>}
    </div>
  );
}

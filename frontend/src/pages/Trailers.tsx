import { useState, type FormEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
  Truck as TruckIcon,
} from "lucide-react";
import { api, ApiError, send } from "../api";
import { useData } from "../useData";
import type { PageProps, Trailer, Truck } from "../types";
import {
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  formatDate,
} from "../ui";

type Mode = "edit" | "assign" | "status";
type HistoryItem = {
  id: string;
  action: string;
  createdAt: string;
  actor: { name: string };
  before: Partial<Trailer> | null;
  after: Partial<Trailer> | null;
  reason: string | null;
};

function TrailerForm({
  trailer,
  mode,
  trucks,
  trailers,
  onClose,
  onSaved,
}: {
  trailer: Trailer | null;
  mode: Mode;
  trucks: Truck[];
  trailers: Trailer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reference, setReference] = useState(trailer);
  const [plate, setPlate] = useState(trailer?.plate ?? "");
  const [label, setLabel] = useState(trailer?.label ?? "");
  const [truckId, setTruckId] = useState(trailer?.assignedTruckId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const title = !reference
    ? "Agregar acoplado"
    : mode === "assign"
      ? "Cambiar camión del acoplado"
      : mode === "status"
        ? reference.active
          ? "Dar de baja acoplado"
          : "Reactivar acoplado"
        : "Editar acoplado";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    setFields({});
    try {
      if (!reference)
        await send("/trailers", "POST", {
          plate,
          label,
          assignedTruckId: truckId || null,
        });
      else if (mode === "assign")
        await send(`/trailers/${reference.id}/truck`, "PATCH", {
          assignedTruckId: truckId || null,
          version: reference.version,
        });
      else if (mode === "status")
        await send(
          `/trailers/${reference.id}`,
          reference.active ? "DELETE" : "PATCH",
          reference.active
            ? undefined
            : { active: true, version: reference.version },
        );
      else
        await send(`/trailers/${reference.id}`, "PATCH", {
          plate,
          label,
          version: reference.version,
        });
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar el acoplado.",
      );
      if (e instanceof ApiError) {
        setFields(e.fields);
        setConflict(e.code === "VERSION_CONFLICT");
      }
      setBusy(false);
    }
  }
  async function refreshReference() {
    if (!reference || busy) return;
    setBusy(true);
    try {
      const result = await api<{ items: Trailer[] }>("/trailers");
      const current = result.items.find((item) => item.id === reference.id);
      if (!current) throw new Error("No se encontró el acoplado.");
      setReference(current);
      setConflict(false);
      setError(
        "Datos actualizados. Conservamos tu selección; revisala antes de guardar.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos actualizar los datos.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} dismissible={!busy}>
      <form className="admin-form" onSubmit={submit}>
        {reference && (
          <div className="admin-access-person">
            <TruckIcon size={24} />
            <div>
              <strong>{reference.plate}</strong>
              <span>{reference.label}</span>
            </div>
          </div>
        )}
        {mode === "edit" && (
          <div className="grid2">
            <Field label="Patente" error={fields.plate}>
              <input
                required
                maxLength={16}
                autoCapitalize="characters"
                placeholder="Ej. AB 456 CD"
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Acoplado / modelo" error={fields.label}>
              <input
                required
                maxLength={120}
                placeholder="Ej. Acoplado cerealero"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
          </div>
        )}
        {(!reference || mode === "assign") && (
          <>
            {reference && (
              <p className="admin-form-intro">
                Camión actual:{" "}
                <strong>
                  {trucks.find((item) => item.id === reference.assignedTruckId)
                    ?.plate ?? "Sin asignar"}
                </strong>
                . Los viajes y vencimientos del acoplado conservarán su
                historial.
              </p>
            )}
            <Field
              label="Camión asignado (opcional)"
              error={fields.assignedTruckId}
              hint="Un camión admite un solo acoplado. Para elegir un camión ocupado, desasigná primero su acoplado actual."
            >
              <select
                value={truckId}
                onChange={(event) => setTruckId(event.target.value)}
                disabled={busy || reference?.active === false}
              >
                <option value="">Sin asignar</option>
                {trucks
                  .filter((item) => item.active)
                  .map((item) => {
                    const occupant = trailers.find(
                      (t) =>
                        t.assignedTruckId === item.id && t.id !== reference?.id,
                    );
                    return (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={!!occupant}
                      >
                        {item.plate} · {item.label}
                        {occupant ? ` (ocupado por ${occupant.plate})` : ""}
                      </option>
                    );
                  })}
              </select>
            </Field>
            {reference?.active === false && (
              <p className="form-error">
                Reactivá el acoplado antes de asignarle un camión.
              </p>
            )}
          </>
        )}
        {mode === "status" && reference && (
          <p className="admin-form-intro">
            {reference.active
              ? "El acoplado dejará de estar disponible para nuevos viajes y se desasignará de su camión. Se conservarán sus viajes, documentos y servicios."
              : "Volverá a estar disponible y sus vencimientos retomarán el seguimiento. Podés asignarle un camión después de reactivarlo."}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            className="button secondary"
            onClick={refreshReference}
            disabled={busy}
          >
            Actualizar datos
          </button>
        )}
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className={`button ${mode === "status" && reference?.active ? "danger" : "primary"}`}
            disabled={
              busy ||
              conflict ||
              (mode === "assign" && reference?.active === false)
            }
          >
            {busy
              ? "Guardando…"
              : mode === "status"
                ? reference?.active
                  ? "Dar de baja"
                  : "Reactivar"
                : !reference
                  ? "Agregar acoplado"
                  : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TrailerHistory({
  trailer,
  trucks,
  onClose,
}: {
  trailer: Trailer;
  trucks: Truck[];
  onClose: () => void;
}) {
  const history = useData<{ items: HistoryItem[] }>(
    `/trailers/${trailer.id}/history`,
  );
  const [page, setPage] = useState(1);
  const items = history.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(items.length / 6));
  const labels: Record<string, string> = {
    CREATED: "Acoplado agregado",
    UPDATED: "Datos actualizados",
    TRUCK_ASSIGNED: "Camión asignado",
    TRUCK_UNASSIGNED: "Camión desasignado",
    DEACTIVATED: "Acoplado dado de baja",
    REACTIVATED: "Acoplado reactivado",
  };
  const truckName = (id: string | null | undefined) =>
    id
      ? (trucks.find((t) => t.id === id)?.plate ?? "Camión registrado")
      : "Sin asignar";
  return (
    <Modal title={`Historial · ${trailer.plate}`} onClose={onClose}>
      <div className="admin-history-body">
        {history.loading && !history.data && <Loading />}
        {history.error && (
          <ErrorState message={history.error} onRetry={history.refresh} />
        )}
        {items.length > 0 && (
          <ol className="admin-timeline">
            {items.slice((page - 1) * 6, page * 6).map((item) => (
              <li key={item.id}>
                <span className="admin-timeline-dot">
                  <History size={13} />
                </span>
                <div>
                  <strong>{labels[item.action] ?? item.action}</strong>
                  <p>
                    {formatDate(item.createdAt, true)} · {item.actor.name}
                  </p>
                  {item.action === "CREATED" ? (
                    <p>
                      {item.after?.plate} · {item.after?.label}
                      <br />
                      Camión: {truckName(item.after?.assignedTruckId)}
                    </p>
                  ) : (
                    item.before?.assignedTruckId !==
                      item.after?.assignedTruckId && (
                      <p>
                        {truckName(item.before?.assignedTruckId)} →{" "}
                        {truckName(item.after?.assignedTruckId)}
                      </p>
                    )
                  )}
                  {item.action === "UPDATED" && (
                    <p>
                      {item.before?.plate} · {item.before?.label} →{" "}
                      {item.after?.plate} · {item.after?.label}
                    </p>
                  )}
                  {item.reason && <p>{item.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {!items.length && !history.loading && !history.error && (
          <EmptyState title="Sin movimientos registrados" />
        )}
        {pageCount > 1 && (
          <div className="admin-pagination">
            <span>
              {page} / {pageCount}
            </span>
            <div>
              <button
                className="button ghost"
                aria-label="Página anterior"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="button ghost"
                aria-label="Página siguiente"
                disabled={page === pageCount}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
        <div className="admin-form-footer">
          <button className="button secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function TrailersPanel({
  adding,
  onCloseAdd,
  onNotify,
}: {
  adding: boolean;
  onCloseAdd: () => void;
  onNotify: PageProps["onNotify"];
}) {
  const trailers = useData<{ items: Trailer[] }>("/trailers");
  const trucks = useData<{ items: Truck[] }>("/trucks");
  const [selection, setSelection] = useState<{
    trailer: Trailer;
    mode: Mode;
  } | null>(null);
  const [history, setHistory] = useState<Trailer | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const items = (trailers.data?.items ?? []).filter(
    (t) =>
      (showInactive || t.active) &&
      `${t.plate} ${t.label} ${t.truck?.plate ?? ""}`
        .toLocaleLowerCase("es-AR")
        .includes(search.toLocaleLowerCase("es-AR")),
  );
  const pageCount = Math.max(1, Math.ceil(items.length / 6));
  const currentPage = Math.min(page, pageCount);
  const reload = () => {
    trailers.refresh();
    trucks.refresh();
  };
  const saved = () => {
    const message = adding
      ? "Acoplado agregado"
      : selection?.mode === "assign"
        ? "Asignación actualizada"
        : selection?.mode === "status"
          ? selection.trailer.active
            ? "Acoplado dado de baja. El historial se conserva."
            : "Acoplado reactivado"
          : "Acoplado actualizado";
    onCloseAdd();
    setSelection(null);
    reload();
    onNotify(message);
  };
  return (
    <>
      <div className="admin-toolbar admin-trailer-toolbar">
        <Field label="Buscar acoplado">
          <input
            type="search"
            placeholder="Patente, modelo o camión…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        <span className="admin-result-count">
          {items.length} {items.length === 1 ? "acoplado" : "acoplados"}
        </span>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => {
              setShowInactive(event.target.checked);
              setPage(1);
            }}
          />
          <span>Incluir inactivos</span>
        </label>
      </div>
      {(trailers.error || trucks.error) && (
        <ErrorState message={trailers.error || trucks.error} onRetry={reload} />
      )}
      {trailers.loading && !trailers.data && <Loading />}
      {trailers.data && !trailers.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-trailer-row">
            <span>Acoplado</span>
            <span>Camión asignado</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {items
            .slice((currentPage - 1) * 6, currentPage * 6)
            .map((trailer) => (
              <article
                key={trailer.id}
                className="admin-record-row admin-trailer-row"
              >
                <div className="admin-row-identity">
                  <span className="admin-item-symbol">
                    <TruckIcon size={24} />
                  </span>
                  <div>
                    <h2>{trailer.plate}</h2>
                    <p>{trailer.label}</p>
                  </div>
                </div>
                <div className="admin-row-secondary">
                  <small className="admin-mobile-label">Camión asignado</small>
                  <strong>{trailer.truck?.plate ?? "Sin asignar"}</strong>
                  {trailer.truck && <small>{trailer.truck.label}</small>}
                </div>
                <span
                  className={`badge ${trailer.active ? "success" : "neutral"}`}
                >
                  {trailer.active ? "Activo" : "Inactivo"}
                </span>
                <div className="admin-row-actions admin-trailer-actions">
                  {trailer.active && (
                    <button
                      className="button secondary"
                      aria-label={`Cambiar camión de ${trailer.plate}`}
                      onClick={() => setSelection({ trailer, mode: "assign" })}
                    >
                      <Link2 size={17} />
                      <span>
                        {trailer.assignedTruckId
                          ? "Cambiar camión"
                          : "Asignar camión"}
                      </span>
                    </button>
                  )}
                  <button
                    className="button ghost admin-icon-button"
                    title="Editar acoplado"
                    aria-label={`Editar acoplado ${trailer.plate}`}
                    onClick={() => setSelection({ trailer, mode: "edit" })}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="button ghost admin-icon-button"
                    title="Historial"
                    aria-label={`Historial de ${trailer.plate}`}
                    onClick={() => setHistory(trailer)}
                  >
                    <History size={19} />
                  </button>
                  <button
                    className={`button ghost admin-icon-button ${trailer.active ? "admin-destructive-action" : ""}`}
                    title={trailer.active ? "Dar de baja" : "Reactivar"}
                    aria-label={`${trailer.active ? "Dar de baja" : "Reactivar"} acoplado ${trailer.plate}`}
                    onClick={() => setSelection({ trailer, mode: "status" })}
                  >
                    {trailer.active ? (
                      <Trash2 size={19} />
                    ) : (
                      <RotateCcw size={19} />
                    )}
                  </button>
                </div>
              </article>
            ))}
          {!items.length && (
            <EmptyState
              title={search ? "No hay resultados" : "Todavía no hay acoplados"}
              description={
                search
                  ? "Probá con otra patente o modelo."
                  : "Registrá un acoplado y asignale un camión cuando esté disponible."
              }
            />
          )}
          <footer className="admin-pagination">
            <span>
              {items.length
                ? `${(currentPage - 1) * 6 + 1}–${Math.min(currentPage * 6, items.length)} de ${items.length}`
                : "0 registros"}
            </span>
            <div>
              <button
                className="button ghost"
                aria-label="Página anterior"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {currentPage} / {pageCount}
              </span>
              <button
                className="button ghost"
                aria-label="Página siguiente"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </footer>
        </section>
      )}
      {(adding || selection) && trucks.data && trailers.data && (
        <TrailerForm
          key={adding ? "new" : `${selection!.trailer.id}-${selection!.mode}`}
          trailer={adding ? null : selection!.trailer}
          mode={adding ? "edit" : selection!.mode}
          trucks={trucks.data.items}
          trailers={trailers.data.items}
          onClose={() => {
            onCloseAdd();
            setSelection(null);
          }}
          onSaved={saved}
        />
      )}
      {history && (
        <TrailerHistory
          trailer={history}
          trucks={trucks.data?.items ?? []}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  Gauge,
  History,
  LoaderCircle,
  Plus,
  Route,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { api, send } from "../../api";
import type {
  Driver,
  PageProps,
  Trailer,
  Trip,
  TripList,
  Truck,
} from "../../types";
import {
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  formatKm,
  formatMoney,
  Loading,
  Modal,
} from "../../ui";
import { useData } from "../../useData";
import { useDesktopRows } from "../../useDesktopRows";

import { TripDetailPager } from "./TripDetailPager";
import { TripStatus } from "./TripSummary";
import { TripListRows } from "./TripListRows";
import {
  type TripAuditEvent,
  paginateDetailText,
  presentTripHistory,
  tripDetailPermissions,
} from "./trip-history";

export function TripsPage({
  user,
  onNotify,
  onNew,
  onEdit,
}: PageProps & { onNew: () => void; onEdit: (id: string) => void }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [truckId, setTruckId] = useState(""),
    [trailerId, setTrailerId] = useState(""),
    [driverId, setDriverId] = useState(""),
    [reviewed, setReviewed] = useState(""),
    [page, setPage] = useState(1),
    [filters, setFilters] = useState(false),
    [detail, setDetail] = useState<Trip | null>(null),
    [cancel, setCancel] = useState<Trip | null>(null),
    [reason, setReason] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<{ items: TripAuditEvent[] } | null>(null),
    [detailTab, setDetailTab] = useState<"data" | "notes" | "history">("data"),
    [historyPage, setHistoryPage] = useState(0),
    [notesPage, setNotesPage] = useState(0),
    [historyError, setHistoryError] = useState("");
  const historyRequest = useRef(0);
  const historyPages = presentTripHistory(history?.items || [], formatKm);
  const detailPermissions = detail ? tripDetailPermissions(detail, user) : null;
  const notesPages = paginateDetailText(detail?.notes || "");
  const pageSize = useDesktopRows(filters ? 470 : 360);
  useEffect(() => setPage(1), [pageSize]);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(truckId ? { truckId } : {}),
    ...(trailerId ? { trailerId } : {}),
    ...(driverId ? { driverId } : {}),
    ...(reviewed ? { reviewed } : {}),
  });
  const { data, error, loading, refresh } = useData<TripList>(
      `/trips?${query}`,
    ),
    { data: trucks } = useData<{ items: Truck[] }>("/trucks"),
    { data: trailers } = useData<{ items: Trailer[] }>("/trailers"),
    { data: drivers } = useData<{ items: Driver[] }>("/drivers");
  const activeFilters = Boolean(
    from || to || truckId || trailerId || driverId || reviewed,
  );
  function filter(fn: (s: string) => void, v: string) {
    fn(v);
    setPage(1);
  }
  async function review(t: Trip) {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      const updated = await send<Trip>(`/trips/${t.id}/review`, "POST", {
        version: t.version,
      });
      setDetail(updated);
      setHistory(null);
      if (detailTab === "history") void viewHistory(updated);
      refresh();
      onNotify("Viaje marcado como revisado.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function cancelTrip(e: FormEvent) {
    e.preventDefault();
    if (!cancel || busy) return;
    setBusy(true);
    setActionError("");
    try {
      await send(`/trips/${cancel.id}/cancel`, "POST", {
        version: cancel.version,
        reason,
      });
      setCancel(null);
      setDetail(null);
      setReason("");
      refresh();
      onNotify("Viaje anulado. El historial se conserva.");
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function viewHistory(t: Trip) {
    const request = ++historyRequest.current;
    setDetailTab("history");
    setHistoryPage(0);
    setHistory(null);
    setHistoryError("");
    try {
      const result = await api<{ items: TripAuditEvent[] }>(
        `/trips/${t.id}/history`,
      );
      if (request === historyRequest.current) setHistory(result);
    } catch (e) {
      if (request === historyRequest.current)
        setHistoryError((e as Error).message);
    }
  }
  function closeDetail() {
    if (busy) return;
    historyRequest.current++;
    setDetail(null);
  }
  function openDetail(t: Trip) {
    historyRequest.current++;
    setDetail(t);
    setDetailTab("data");
    setHistoryPage(0);
    setNotesPage(0);
    setHistory(null);
    setHistoryError("");
    setActionError("");
  }
  return (
    <div className="workspace-page trips-workspace">
      <div className="workspace-heading">
        <h1>{user.role === "ADMIN" ? "Viajes" : "Mis viajes"}</h1>
        <button className="button primary" onClick={onNew}>
          <Plus size={20} />
          Cargar viaje
        </button>
      </div>
      <section className="panel trip-list-panel">
        <div className="list-toolbar">
          <div className="list-toolbar-title">
            <h2>
              {data?.total || 0} {(data?.total || 0) === 1 ? "viaje" : "viajes"}
            </h2>
          </div>
          <button
            className={`button secondary filter-toggle ${activeFilters ? "filter-active" : ""}`}
            onClick={() => setFilters(!filters)}
            aria-expanded={filters}
          >
            <SlidersHorizontal size={18} />
            Filtros{activeFilters && <i />}
            <ChevronDown size={16} />
          </button>
        </div>
        {filters && (
          <div className="trip-filters">
            <Field label="Desde">
              <input
                type="date"
                value={from}
                onChange={(e) => filter(setFrom, e.target.value)}
              />
            </Field>
            <Field label="Hasta">
              <input
                type="date"
                value={to}
                onChange={(e) => filter(setTo, e.target.value)}
              />
            </Field>
            <Field label="Camión">
              <select
                value={truckId}
                onChange={(e) => filter(setTruckId, e.target.value)}
              >
                <option value="">Todos los camiones</option>
                {trucks?.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plate}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Acoplado">
              <select
                value={trailerId}
                onChange={(e) => filter(setTrailerId, e.target.value)}
              >
                <option value="">Todos los acoplados</option>
                {trailers?.items.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plate}
                  </option>
                ))}
              </select>
            </Field>
            {user.role === "ADMIN" && (
              <Field label="Chofer">
                <select
                  value={driverId}
                  onChange={(e) => filter(setDriverId, e.target.value)}
                >
                  <option value="">Todos los choferes</option>
                  {drivers?.items.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Revisión">
              <select
                value={reviewed}
                onChange={(e) => filter(setReviewed, e.target.value)}
              >
                <option value="">Todos los estados</option>
                <option value="no">Por revisar</option>
                <option value="yes">Revisados</option>
              </select>
            </Field>
            {activeFilters && (
              <button
                className="text-button clear-filters"
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setTruckId("");
                  setTrailerId("");
                  setDriverId("");
                  setReviewed("");
                  setPage(1);
                }}
              >
                <X size={15} />
                Limpiar filtros
              </button>
            )}
          </div>
        )}
        {data && (
          <div className="list-totals">
            <span>
              <strong>{formatKm(data.totals.distanceKm)}</strong> km recorridos
            </span>
            {user.role === "ADMIN" && (
              <span>
                <strong>{formatMoney(data.totals.allowance)}</strong> en
                viáticos
              </span>
            )}
            {loading && <LoaderCircle className="spin" size={17} />}
          </div>
        )}
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <>
            <TripListRows
              items={data.items}
              role={user.role}
              onOpen={openDetail}
            />
            {data.total > data.pageSize && (
              <div className="pagination">
                <span>
                  Página {page} de {Math.ceil(data.total / data.pageSize)}
                </span>
                <div>
                  <button
                    className="icon-button"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                    aria-label="Página anterior"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={page * data.pageSize >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                    aria-label="Página siguiente"
                  >
                    <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title={
              activeFilters
                ? "No encontramos viajes con estos filtros"
                : "Todavía no hay viajes"
            }
            description={
              activeFilters
                ? "Probá otro período o limpiá los filtros."
                : "Usá Cargar viaje para registrar el primero."
            }
            icon={<Route size={30} />}
          >
            {!activeFilters && (
              <button className="button primary" onClick={onNew}>
                <Plus size={20} />
                Cargar primer viaje
              </button>
            )}
          </EmptyState>
        )}
      </section>
      {detail && (
        <Modal
          title="Detalle del viaje"
          onClose={closeDetail}
          dismissible={!busy}
          wide
        >
          <div className="trip-detail-body">
            <div
              className="trip-detail-tabs"
              aria-label="Información del viaje"
            >
              <button
                type="button"
                className={detailTab === "data" ? "active" : ""}
                aria-pressed={detailTab === "data"}
                onClick={() => setDetailTab("data")}
              >
                Datos
              </button>
              {detail.notes && (
                <button
                  type="button"
                  className={detailTab === "notes" ? "active" : ""}
                  aria-pressed={detailTab === "notes"}
                  onClick={() => setDetailTab("notes")}
                >
                  Observaciones
                </button>
              )}
              <button
                type="button"
                className={detailTab === "history" ? "active" : ""}
                aria-pressed={detailTab === "history"}
                onClick={() =>
                  history ? setDetailTab("history") : void viewHistory(detail)
                }
              >
                <History size={16} />
                Historial
              </button>
            </div>
            <div className="trip-detail-content" aria-live="polite">
              {detailTab === "data" && (
                <>
                  <div className="trip-detail-route">
                    <div>
                      <span>Salida</span>
                      <strong>{detail.origin}</strong>
                      <small>{formatDate(detail.departureAt, true)}</small>
                    </div>
                    <ArrowRight size={21} />
                    <div>
                      <span>Llegada</span>
                      <strong>{detail.destination}</strong>
                      <small>{formatDate(detail.arrivalAt, true)}</small>
                    </div>
                  </div>
                  <div className="trip-detail-distance">
                    <div>
                      <Gauge size={21} />
                      <strong>
                        {formatKm(detail.distanceKm)} <small>km</small>
                      </strong>
                    </div>
                    <TripStatus trip={detail} />
                  </div>
                  <dl className="trip-detail-data">
                    <div className="trip-detail-km100">
                      <dt>Km al 100%</dt>
                      <dd>
                        {detail.km100 == null
                          ? "Sin informar"
                          : `${formatKm(detail.km100)} km`}
                        {detail.km100Context?.mode === "PENDING" && (
                          <small className="trip-km100-pending-label">
                            Pendiente de validar el calendario. Editá el viaje
                            para resolverlo antes de marcarlo revisado.
                          </small>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Chofer</dt>
                      <dd>{detail.driver.name}</dd>
                    </div>
                    <div>
                      <dt>Camión</dt>
                      <dd>
                        {detail.truck.plate}
                        <small>{detail.truck.label}</small>
                      </dd>
                    </div>
                    <div>
                      <dt>Acoplado</dt>
                      <dd>
                        {detail.trailer?.plate || "Sin acoplado registrado"}
                        {detail.trailer && (
                          <small>{detail.trailer.label}</small>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Viáticos</dt>
                      <dd>{formatMoney(detail.allowance)}</dd>
                    </div>
                    <div>
                      <dt>Odómetro al salir</dt>
                      <dd>
                        {detail.startKm === null
                          ? "Sin informar"
                          : `${formatKm(detail.startKm)} km`}
                      </dd>
                    </div>
                    <div>
                      <dt>Odómetro al llegar</dt>
                      <dd>
                        {detail.endKm === null
                          ? "Sin informar"
                          : `${formatKm(detail.endKm)} km`}
                      </dd>
                    </div>
                    <div>
                      <dt>Controles</dt>
                      <dd>{detail.controlCount ?? "Sin informar"}</dd>
                    </div>
                    {detail.mileageMode === "DISTANCE" && (
                      <div>
                        <dt>Kilometraje del camión</dt>
                        <dd>
                          {detail.distanceSource
                            ? `Suma para vencimientos · ${detail.distanceSource === "DRIVER" ? "Chofer" : "Administración"}`
                            : "Carga histórica de administración"}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt>Registrado</dt>
                      <dd>{formatDate(detail.createdAt, true)}</dd>
                    </div>
                  </dl>
                </>
              )}
              {detailTab === "notes" && (
                <div className="trip-detail-reading">
                  <p className="trip-detail-long-text">
                    {notesPages[notesPage]}
                  </p>
                  <TripDetailPager
                    page={notesPage}
                    total={notesPages.length}
                    onPage={setNotesPage}
                  />
                </div>
              )}
              {detailTab === "history" && (
                <div className="trip-detail-history">
                  {historyError ? (
                    <div className="trip-detail-history-error">
                      <p className="form-error" role="alert">
                        {historyError}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => viewHistory(detail)}
                      >
                        Reintentar
                      </button>
                    </div>
                  ) : !history ? (
                    <Loading label="Buscando cambios…" />
                  ) : history.items.length ? (
                    <>
                      <div className="trip-detail-events">
                        {historyPages[historyPage]?.map(
                          ({
                            event,
                            reason,
                            part,
                            parts,
                            title,
                            trailerChange,
                            km100Change,
                          }) => (
                            <article key={`${event.id}-${part}`}>
                              <span className="trip-detail-audit-dot" />
                              <div>
                                <strong>{title}</strong>
                                <small>
                                  {formatDate(event.createdAt, true)}
                                  {event.actor?.name
                                    ? ` · ${event.actor.name}`
                                    : ""}
                                </small>
                                {part === 1 && trailerChange && (
                                  <p className="trip-detail-long-text">
                                    {trailerChange}
                                  </p>
                                )}
                                {part === 1 && km100Change && (
                                  <p className="trip-detail-long-text">
                                    {km100Change}
                                  </p>
                                )}
                                {reason && (
                                  <>
                                    <p className="trip-detail-long-text">
                                      {reason}
                                    </p>
                                    {parts > 1 && (
                                      <span className="trip-detail-part">
                                        Motivo · parte {part} de {parts}
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </article>
                          ),
                        )}
                      </div>
                      <TripDetailPager
                        page={historyPage}
                        total={historyPages.length}
                        onPage={setHistoryPage}
                      />
                    </>
                  ) : (
                    <EmptyState title="Sin cambios adicionales" />
                  )}
                </div>
              )}
            </div>
            {actionError && (
              <div className="trip-detail-action-error form-error" role="alert">
                {actionError}
              </div>
            )}
            <div className="trip-detail-actions">
              {detailPermissions?.canEdit && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => onEdit(detail.id)}
                >
                  <FilePenLine size={18} />
                  {user.role === "ADMIN" &&
                  detail.km100Context?.mode === "PENDING"
                    ? "Validar km al 100%"
                    : "Editar viaje"}
                </button>
              )}
              {detailPermissions?.canReview && (
                <button
                  className="button primary"
                  disabled={busy || detail.km100Context?.mode === "PENDING"}
                  title={
                    detail.km100Context?.mode === "PENDING"
                      ? "Primero validá los km con el calendario confirmado."
                      : undefined
                  }
                  onClick={() => review(detail)}
                >
                  <Check size={19} />
                  {busy ? "Guardando…" : "Marcar revisado"}
                </button>
              )}
              {detailPermissions?.canCancel && (
                <button
                  className="button ghost danger-text"
                  disabled={busy}
                  onClick={() => {
                    setCancel(detail);
                    setActionError("");
                  }}
                >
                  Anular viaje
                </button>
              )}
              {detailPermissions?.showClose ? (
                <button className="button secondary" onClick={closeDetail}>
                  Cerrar
                </button>
              ) : null}
            </div>
          </div>
        </Modal>
      )}
      {cancel && (
        <Modal
          title="Anular viaje"
          onClose={() => {
            if (!busy) setCancel(null);
          }}
          dismissible={!busy}
        >
          <form className="modal-body" onSubmit={cancelTrip}>
            <p>
              El viaje se quitará de los totales y se recalculará el
              kilometraje. Su historial quedará conservado.
            </p>
            <Field label="Motivo de la anulación">
              <textarea
                required
                minLength={3}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contanos por qué se anula"
              />
            </Field>
            {actionError && (
              <p className="form-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="row-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setCancel(null)}
                disabled={busy}
              >
                Volver
              </button>
              <button className="button danger" disabled={busy}>
                {busy ? "Anulando…" : "Confirmar anulación"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

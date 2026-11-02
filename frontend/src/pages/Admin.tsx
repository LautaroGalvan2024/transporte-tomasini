import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  X,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  Gauge,
  History,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  ShieldCheck,
  Truck as TruckIcon,
  UserRound,
  Wrench,
} from "lucide-react";
import { api, send, ApiError } from "../api";
import type {
  Dashboard,
  Driver,
  Invitation,
  InvitationList,
  Notification,
  Obligation,
  PageProps,
  Renewal,
  Settings,
  TripList,
  Truck,
} from "../types";
import {
  EmptyState,
  Field,
  Modal,
  StatusBadge,
  formatDate,
  formatKm,
  formatMoney,
} from "../ui";
import "../admin.css";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const dateToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const dateTimeInput = (value = new Date().toISOString()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(" ", "T");
const businessInstant = (value: string) =>
  new Date(`${value}:00-03:00`).toISOString();
const optionalNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);
const dateLabel = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: TIMEZONE,
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(
        new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value),
      )
    : "Sin definir";
const statusText = (status: string) =>
  ({
    OVERDUE: "Vencido",
    UPCOMING: "Por vencer",
    OK: "Al día",
    UNCONFIGURED: "Sin programar",
    SENT: "Enviado",
    FAILED: "No enviado",
    PENDING: "Pendiente",
    SENDING: "Enviando",
    SUPERSEDED: "Reemplazado",
    CANCELLED: "Resuelto",
  })[status] || status;
const err = (error: unknown) =>
  error instanceof Error ? error.message : "No pudimos completar la acción.";

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setError("");
    api<T>(path, { signal: controller.signal })
      .then((value) => {
        if (current) setData(value);
      })
      .catch((e) => {
        if (current) setError(err(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, revision]);
  return { data, loading, error, reload: () => setRevision((v) => v + 1) };
}

function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page-heading admin-page-heading">
      <h1>{title}</h1>
      {action}
    </header>
  );
}
function usePageSize(reserved = 340, rowHeight = 76) {
  const calculate = () =>
    window.innerWidth >= 1100 && window.innerHeight >= 700
      ? Math.max(
          2,
          Math.min(8, Math.floor((window.innerHeight - reserved) / rowHeight)),
        )
      : 6;
  const [size, setSize] = useState(calculate);
  useEffect(() => {
    const resize = () => setSize(calculate());
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [reserved, rowHeight]);
  return size;
}
function Pagination({
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
function usePagination<T>(items: T[], pageSize: number, resetKey = "") {
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

function LoadState({
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
        <button className="button secondary" onClick={retry}>
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

function FormError({ message }: { message: string }) {
  return message ? (
    <div className="form-error" role="alert">
      <CircleAlert size={18} />
      <span>{message}</span>
    </div>
  ) : null;
}
function useFormStatus() {
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
function FormFooter({
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

function OwnerLabel({ obligation }: { obligation: Obligation }) {
  return (
    <span className="admin-owner">
      {obligation.truckId ? <TruckIcon size={15} /> : <UserRound size={15} />}
      {obligation.truck?.plate || obligation.driver?.name || "Sin asignación"}
    </span>
  );
}
function DueSummary({ obligation }: { obligation: Obligation }) {
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
    </div>
  );
}

export function AdminDashboard({ onNavigate }: PageProps) {
  const state = useLoad<Dashboard>("/dashboard");
  const [tab, setTab] = useState("attention");
  const pageSize = usePageSize(440, 84);
  const pending =
    state.data?.obligations.filter(
      (item) => item.active && item.status !== "OK",
    ) || [];
  const alerts = usePagination(pending, pageSize);
  const trucks = usePagination(
    state.data?.trucks.filter((truck) => truck.active) || [],
    pageSize,
  );
  const trips = usePagination(state.data?.recentTrips || [], pageSize);
  return (
    <div className="admin-page admin-dashboard">
      <PageHeading
        title="Resumen"
        action={
          <button
            className="button primary"
            onClick={() => onNavigate("new-trip")}
          >
            <Plus size={19} />
            Cargar viaje
          </button>
        }
      />
      <LoadState
        loading={state.loading && !state.data}
        error={state.error}
        retry={state.reload}
      />
      {state.data && !state.error && (
        <>
          <div className="admin-metrics">
            <button onClick={() => onNavigate("reports")}>
              <span>Kilómetros este mes</span>
              <strong>
                {formatKm(state.data.stats.kilometersThisMonth)}{" "}
                <small>km</small>
              </strong>
              <span>{state.data.stats.tripsThisMonth} viajes</span>
            </button>
            <button onClick={() => onNavigate("trips")}>
              <span>Viajes por revisar</span>
              <strong>{state.data.stats.pendingReviews}</strong>
              <span>
                Ver viajes <ArrowRight size={15} />
              </span>
            </button>
            <button
              className={state.data.stats.overdue ? "has-alerts" : ""}
              onClick={() => onNavigate("obligations")}
            >
              <span>Vencimientos pendientes</span>
              <strong>{pending.length}</strong>
              <span>
                {state.data.stats.overdue} vencidos ·{" "}
                {state.data.stats.upcoming} próximos
              </span>
            </button>
          </div>
          <section className="admin-surface admin-dashboard-detail">
            <div className="admin-section-toolbar">
              <div className="admin-tabs" aria-label="Resumen de actividad">
                {[
                  ["attention", "Vencimientos"],
                  ["trips", "Últimos viajes"],
                  ["fleet", "Flota"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={tab === key ? "active" : ""}
                    aria-pressed={tab === key}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="button ghost"
                onClick={() =>
                  onNavigate(
                    tab === "attention"
                      ? "obligations"
                      : tab === "trips"
                        ? "trips"
                        : "fleet",
                  )
                }
              >
                Ver todos <ArrowRight size={17} />
              </button>
            </div>
            {tab === "attention" && (
              <>
                {alerts.items.map((item) => (
                  <button
                    className="admin-overview-row"
                    key={item.id}
                    onClick={() => onNavigate("obligations")}
                  >
                    <span
                      className={`admin-item-symbol ${item.status.toLowerCase()}`}
                    >
                      {item.kind === "SERVICE" ? (
                        <Wrench size={20} />
                      ) : (
                        <FileCheck2 size={20} />
                      )}
                    </span>
                    <span className="admin-row-name">
                      <strong>{item.title}</strong>
                      <OwnerLabel obligation={item} />
                    </span>
                    <DueSummary obligation={item} />
                    <StatusBadge status={item.status} />
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!pending.length && (
                  <EmptyState
                    title={
                      state.data.obligations.length
                        ? "Sin vencimientos pendientes"
                        : "Todavía no hay vencimientos"
                    }
                    description={
                      state.data.obligations.length
                        ? undefined
                        : "Agregá el primer servicio o documento."
                    }
                    icon={<ShieldCheck size={26} />}
                  />
                )}
                <Pagination
                  page={alerts.page}
                  pageSize={pageSize}
                  total={pending.length}
                  onPage={alerts.setPage}
                />
              </>
            )}
            {tab === "trips" && (
              <>
                {trips.items.map((trip) => (
                  <button
                    className="admin-overview-row"
                    key={trip.id}
                    onClick={() => onNavigate("trips")}
                  >
                    <span className="admin-item-symbol">
                      <Route size={20} />
                    </span>
                    <span className="admin-row-name">
                      <strong>
                        {trip.origin} → {trip.destination}
                      </strong>
                      <small>
                        {trip.driver.name} · {trip.truck.plate}
                      </small>
                    </span>
                    <span className="admin-row-date">
                      {dateLabel(trip.departureAt)}
                    </span>
                    <strong>{formatKm(trip.distanceKm)} km</strong>
                    <span
                      className={`badge ${trip.reviewedAt ? "success" : "neutral"}`}
                    >
                      {trip.reviewedAt ? "Revisado" : "Por revisar"}
                    </span>
                  </button>
                ))}
                {!state.data.recentTrips.length && (
                  <EmptyState
                    title="Todavía no hay viajes"
                    description="Cargá el primer viaje para verlo acá."
                  />
                )}
                <Pagination
                  page={trips.page}
                  pageSize={pageSize}
                  total={state.data.recentTrips.length}
                  onPage={trips.setPage}
                />
              </>
            )}
            {tab === "fleet" && (
              <>
                {trucks.items.map((truck) => (
                  <button
                    className="admin-overview-row"
                    key={truck.id}
                    onClick={() => onNavigate("fleet")}
                  >
                    <span className="admin-item-symbol">
                      <TruckIcon size={23} />
                    </span>
                    <span className="admin-row-name">
                      <strong>{truck.plate}</strong>
                      <small>{truck.label}</small>
                    </span>
                    <span className="admin-row-date">
                      {dateLabel(truck.odometerAt)}
                    </span>
                    <strong>{formatKm(truck.odometer)} km</strong>
                    <ChevronRight size={17} />
                  </button>
                ))}
                {!trucks.items.length && (
                  <EmptyState
                    title="Todavía no hay camiones"
                    description="Agregá una unidad desde Flota."
                  />
                )}
                <Pagination
                  page={trucks.page}
                  pageSize={pageSize}
                  total={
                    state.data.trucks.filter((truck) => truck.active).length
                  }
                  onPage={trucks.setPage}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TruckForm({
  truck,
  onClose,
  onSaved,
}: {
  truck: Truck | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plate, setPlate] = useState(truck?.plate || "");
  const [label, setLabel] = useState(truck?.label || "");
  const [initial, setInitial] = useState("");
  const [at, setAt] = useState(dateTimeInput());
  const [active, setActive] = useState(truck?.active ?? true);
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(
        truck ? `/trucks/${truck.id}` : "/trucks",
        truck ? "PATCH" : "POST",
        truck
          ? { plate: plate.trim().toUpperCase(), label: label.trim(), active }
          : {
              plate: plate.trim().toUpperCase(),
              label: label.trim(),
              initialOdometer: Number(initial),
              initialOdometerAt: businessInstant(at),
            },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={truck ? "Editar camión" : "Agregar camión"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <FormError message={form.message} />
        <div className="grid2">
          <Field label="Patente" error={form.fields.plate}>
            <input
              required
              autoCapitalize="characters"
              maxLength={16}
              placeholder="Ej. AB 123 CD"
              value={plate}
              onChange={(event) => setPlate(event.target.value)}
            />
          </Field>
          <Field label="Camión / modelo" error={form.fields.label}>
            <input
              required
              maxLength={100}
              placeholder="Ej. Mercedes-Benz 1634"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </div>
        {!truck && (
          <div className="admin-form-block">
            <h3>
              <Gauge size={18} />
              Kilometraje inicial
            </h3>
            <div className="grid2">
              <Field
                label="Lectura del odómetro"
                error={form.fields.initialOdometer}
                hint="El número que marca el tablero del camión."
              >
                <input
                  required
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="9999999"
                  step="1"
                  placeholder="0"
                  value={initial}
                  onChange={(event) => setInitial(event.target.value)}
                />
              </Field>
              <Field
                label="Fecha y hora de la lectura"
                error={form.fields.initialOdometerAt}
              >
                <input
                  required
                  type="datetime-local"
                  value={at}
                  max={dateTimeInput()}
                  onChange={(event) => setAt(event.target.value)}
                />
              </Field>
            </div>
          </div>
        )}
        {truck && (
          <label className="admin-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>
              <strong>Camión activo</strong>
              <small>Disponible para nuevos viajes y asignaciones.</small>
            </span>
          </label>
        )}
        <FormFooter
          busy={form.busy}
          onClose={onClose}
          label={truck ? "Guardar cambios" : "Agregar camión"}
        />
      </form>
    </Modal>
  );
}

export function FleetPage({ onNotify }: PageProps) {
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const [editing, setEditing] = useState<Truck | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const items =
    trucks.data?.items.filter((truck) => showInactive || truck.active) || [];
  const pageSize = usePageSize(430, 86);
  const paged = usePagination(items, pageSize, String(showInactive));
  return (
    <div className="admin-page">
      <PageHeading
        title="Flota"
        action={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={19} />
            Agregar camión
          </button>
        }
      />
      <div className="admin-toolbar">
        <span className="admin-result-count">
          {items.length} {items.length === 1 ? "camión" : "camiones"}
        </span>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          <span>Incluir inactivos</span>
        </label>
      </div>
      <LoadState
        loading={trucks.loading && !trucks.data}
        error={trucks.error || drivers.error}
        retry={() => {
          trucks.reload();
          drivers.reload();
        }}
      />
      {trucks.data && !trucks.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-fleet-row">
            <span>Camión</span>
            <span>Chofer habitual</span>
            <span>Odómetro</span>
            <span>Estado</span>
            <span />
          </div>
          {paged.items.map((truck) => {
            const assigned =
              drivers.data?.items.filter(
                (driver) =>
                  driver.active && driver.assignedTruckId === truck.id,
              ) || [];
            return (
              <article
                className="admin-record-row admin-fleet-row"
                key={truck.id}
              >
                <div className="admin-row-identity">
                  <span className="admin-item-symbol">
                    <TruckIcon size={24} />
                  </span>
                  <div>
                    <h2>{truck.plate}</h2>
                    <p>{truck.label}</p>
                  </div>
                </div>
                <div className="admin-row-secondary">
                  <small className="admin-mobile-label">Chofer habitual</small>
                  {assigned.map((driver) => driver.name).join(", ") ||
                    "Sin asignar"}
                </div>
                <div className="admin-row-value">
                  <strong>{formatKm(truck.odometer)} km</strong>
                  <small>{dateLabel(truck.odometerAt)}</small>
                </div>
                <span
                  className={`badge ${truck.active ? "success" : "neutral"}`}
                >
                  {truck.active ? "Activo" : "Inactivo"}
                </span>
                <button
                  className="button ghost"
                  aria-label={`Editar camión ${truck.plate}`}
                  onClick={() => setEditing(truck)}
                >
                  <Pencil size={17} />
                  <span>Editar</span>
                </button>
              </article>
            );
          })}
          {!items.length && (
            <EmptyState
              title={
                showInactive
                  ? "Todavía no hay camiones"
                  : "No hay camiones activos"
              }
              description="Agregá una unidad con su patente y odómetro."
            />
          )}
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={items.length}
            onPage={paged.setPage}
          />
        </section>
      )}
      {editing && (
        <TruckForm
          truck={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            trucks.reload();
            onNotify(
              editing === "new" ? "Camión agregado" : "Camión actualizado",
            );
          }}
        />
      )}
    </div>
  );
}

function DriverForm({
  driver,
  trucks,
  onClose,
  onSaved,
}: {
  driver: Driver | null;
  trucks: Truck[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(driver?.name || "");
  const [username, setUsername] = useState(driver?.username || "");
  const [phone, setPhone] = useState(driver?.phone || "");
  const [assignedTruckId, setAssignedTruckId] = useState(
    driver?.assignedTruckId || "",
  );
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(driver?.active ?? true);
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(
        driver ? `/drivers/${driver.id}` : "/drivers",
        driver ? "PATCH" : "POST",
        {
          name: name.trim(),
          username: username.trim(),
          phone: phone.trim() || null,
          assignedTruckId: assignedTruckId || null,
          ...(driver ? { active } : { password }),
        },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={driver ? "Editar chofer" : "Agregar chofer"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <FormError message={form.message} />
        <Field label="Nombre y apellido" error={form.fields.name}>
          <input
            required
            autoComplete="name"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <div className="grid2">
          <Field
            label="Usuario para ingresar"
            hint="Un nombre simple, sin espacios."
            error={form.fields.username}
          >
            <input
              required
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </Field>
          <Field label="Teléfono (opcional)" error={form.fields.phone}>
            <input
              type="tel"
              autoComplete="tel"
              maxLength={40}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </Field>
        </div>
        <Field label="Camión habitual" error={form.fields.assignedTruckId}>
          <select
            value={assignedTruckId}
            onChange={(event) => setAssignedTruckId(event.target.value)}
          >
            <option value="">Sin asignar por ahora</option>
            {trucks
              .filter((truck) => truck.active || truck.id === assignedTruckId)
              .map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate} · {truck.label}
                  {truck.active ? "" : " (inactivo)"}
                </option>
              ))}
          </select>
        </Field>
        {!driver && (
          <Field
            label="Contraseña provisoria"
            hint="Al ingresar por primera vez, el chofer deberá cambiarla. Mínimo 12 caracteres."
            error={form.fields.password}
          >
            <input
              required
              minLength={12}
              maxLength={128}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
        )}
        {driver && (
          <label className="admin-check">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>
              <strong>Acceso activo</strong>
              <small>
                Al desactivarlo se cierran sus sesiones y se conserva el
                historial.
              </small>
            </span>
          </label>
        )}
        <FormFooter
          busy={form.busy}
          onClose={onClose}
          label={driver ? "Guardar cambios" : "Crear acceso"}
        />
      </form>
    </Modal>
  );
}

function PasswordForm({
  driver,
  onClose,
  onSaved,
}: {
  driver: Driver;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    if (password !== repeat) {
      form.fail(new Error("Las contraseñas deben ser iguales."));
      return;
    }
    form.begin();
    try {
      await send(`/drivers/${driver.id}/password`, "POST", { password });
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title="Restablecer acceso"
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <p className="admin-form-intro">
          Definí una contraseña provisoria para <strong>{driver.name}</strong>.
          Sus sesiones actuales se cerrarán y deberá cambiarla al ingresar.
        </p>
        <FormError message={form.message} />
        <Field
          label="Nueva contraseña provisoria"
          error={form.fields.password}
          hint="Mínimo 12 caracteres."
        >
          <input
            required
            minLength={12}
            maxLength={128}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Repetir contraseña">
          <input
            required
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </Field>
        <FormFooter
          busy={form.busy}
          onClose={onClose}
          label="Restablecer acceso"
        />
      </form>
    </Modal>
  );
}

function InvitationForm({
  drivers,
  onClose,
  onSaved,
}: {
  drivers: Driver[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState<"DRIVER" | "ADMIN">("DRIVER");
  const [driverId, setDriverId] = useState("");
  const [name, setName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [created, setCreated] = useState<{
    invitation: Invitation;
    joinUrl: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      const result = await send<{ invitation: Invitation; joinUrl: string }>(
        "/invitations",
        "POST",
        {
          role,
          name: name.trim() || null,
          driverId: role === "DRIVER" ? driverId || null : null,
          expiresInDays: Number(expiresInDays),
        },
      );
      setCreated(result);
      form.setBusy(false);
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.joinUrl);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Seleccioná el enlace y copialo manualmente.");
    }
  }
  return (
    <Modal
      title={created ? "Invitación creada" : "Invitar al equipo"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      {created ? (
        <div className="admin-form">
          <div className="admin-invite-success">
            <CheckCircle2 size={28} />
            <div>
              <strong>
                {created.invitation.name ||
                  created.invitation.driverName ||
                  (created.invitation.role === "ADMIN"
                    ? "Administrador"
                    : "Chofer")}
              </strong>
              <p>Vence el {formatDate(created.invitation.expiresAt, true)}.</p>
            </div>
          </div>
          <Field
            label="Enlace de invitación"
            hint="Copialo ahora. Por seguridad, no se podrá volver a consultar."
          >
            <input
              className="admin-invite-link"
              readOnly
              value={created.joinUrl}
              onFocus={(event) => event.target.select()}
            />
          </Field>
          <FormError message={copyError} />
          <p className="admin-field-note">
            Compartilo en privado con la persona invitada. Podrá elegir su
            usuario y contraseña.
          </p>
          <div className="admin-form-footer">
            <button className="button secondary" onClick={onClose}>
              Cerrar
            </button>
            <button className="button primary" onClick={copy}>
              {copied ? <Check size={18} /> : <Copy size={18} />}{" "}
              {copied ? "Enlace copiado" : "Copiar enlace"}
            </button>
          </div>
        </div>
      ) : (
        <form className="admin-form" onSubmit={submit}>
          <FormError message={form.message} />
          <div className="grid2">
            <Field label="Tipo de acceso" error={form.fields.role}>
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as "DRIVER" | "ADMIN");
                  setDriverId("");
                }}
              >
                <option value="DRIVER">Chofer</option>
                <option value="ADMIN">Administrador</option>
              </select>
            </Field>
            <Field label="El enlace vence en" error={form.fields.expiresInDays}>
              <select
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              >
                <option value="1">1 día</option>
                <option value="7">7 días</option>
                <option value="15">15 días</option>
                <option value="30">30 días</option>
              </select>
            </Field>
          </div>
          {role === "DRIVER" && (
            <Field label="Persona" error={form.fields.driverId}>
              <select
                value={driverId}
                onChange={(event) => setDriverId(event.target.value)}
              >
                <option value="">Nuevo chofer</option>
                {drivers
                  .filter((driver) => driver.active)
                  .map((driver) => (
                    <option key={driver.id} value={driver.id}>
                      {driver.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {!driverId && (
            <Field
              label="Nombre y apellido (opcional)"
              error={form.fields.name}
            >
              <input
                value={name}
                maxLength={100}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          {driverId && (
            <div className="admin-callout" role="note">
              <CircleAlert size={19} />
              <p>
                Este enlace reemplaza los anteriores para este chofer. Al
                aceptarlo, se cambiarán su usuario y contraseña y se cerrarán
                sus sesiones, sin perder sus viajes.
              </p>
            </div>
          )}
          {role === "ADMIN" && (
            <p className="admin-field-note">
              Tendrá acceso a viajes, flota, equipo, vencimientos y
              preferencias.
            </p>
          )}
          <FormFooter
            busy={form.busy}
            onClose={onClose}
            label="Crear invitación"
          />
        </form>
      )}
    </Modal>
  );
}
function InvitationsPanel({
  revision,
  onNotify,
}: {
  revision: number;
  onNotify: PageProps["onNotify"];
}) {
  const pageSize = usePageSize(430, 88);
  const [page, setPage] = useState(1);
  const state = useLoad<InvitationList>(
    `/invitations?page=${page}&pageSize=${pageSize}`,
  );
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const form = useFormStatus();
  useEffect(() => {
    setPage(1);
    state.reload();
  }, [revision]);
  useEffect(() => setPage(1), [pageSize]);
  useEffect(() => {
    if (state.data && page > 1 && !state.data.items.length)
      setPage(Math.max(1, Math.ceil(state.data.total / pageSize)));
  }, [state.data, page, pageSize]);
  async function revoke() {
    if (!revoking || form.busy) return;
    form.begin();
    try {
      await send(`/invitations/${revoking.id}/revoke`, "POST", {});
      setRevoking(null);
      form.setBusy(false);
      state.reload();
      onNotify("Invitación revocada");
    } catch (error) {
      form.fail(error);
    }
  }
  const labels = {
    PENDING: "Pendiente",
    ACCEPTED: "Aceptada",
    REVOKED: "Revocada",
    EXPIRED: "Vencida",
  };
  return (
    <>
      <LoadState
        loading={state.loading && !state.data}
        error={state.error}
        retry={state.reload}
      />
      {state.data && !state.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-invitation-row">
            <span>Invitación</span>
            <span>Acceso</span>
            <span>Vencimiento</span>
            <span>Estado</span>
            <span />
          </div>
          {state.data.items.map((item) => (
            <article
              key={item.id}
              className="admin-record-row admin-invitation-row"
            >
              <div className="admin-row-identity">
                <span className="admin-item-symbol">
                  <Link2 size={21} />
                </span>
                <div>
                  <h2>
                    {item.name ||
                      item.driverName ||
                      (item.role === "ADMIN"
                        ? "Nuevo administrador"
                        : "Nuevo chofer")}
                  </h2>
                  <p>Creada {dateLabel(item.createdAt)}</p>
                </div>
              </div>
              <span>{item.role === "ADMIN" ? "Administrador" : "Chofer"}</span>
              <div className="admin-row-value">
                <small className="admin-mobile-label">Vence</small>
                {dateLabel(item.expiresAt)}
              </div>
              <span
                className={`badge ${item.status === "ACCEPTED" ? "success" : item.status === "PENDING" ? "warning" : "neutral"}`}
              >
                {labels[item.status]}
              </span>
              {item.status === "PENDING" ? (
                <button
                  className="button ghost"
                  onClick={() => {
                    form.clear();
                    setRevoking(item);
                  }}
                >
                  <X size={17} />
                  Revocar
                </button>
              ) : (
                <span />
              )}
            </article>
          ))}
          {!state.data.items.length && (
            <EmptyState
              title="Todavía no hay invitaciones"
              description="Creá un enlace para sumar un chofer o administrador."
              icon={<Link2 size={26} />}
            />
          )}
          <Pagination
            page={page}
            pageSize={pageSize}
            total={state.data.total}
            onPage={setPage}
            busy={state.loading}
          />
        </section>
      )}
      {revoking && (
        <Modal
          title="Revocar invitación"
          onClose={() => {
            if (!form.busy) setRevoking(null);
          }}
        >
          <div className="admin-form">
            <p>
              El enlace de{" "}
              {revoking.name || revoking.driverName || "esta invitación"} dejará
              de funcionar. Podés crear una nueva invitación después.
            </p>
            <FormError message={form.message} />
            <div className="admin-form-footer">
              <button
                className="button secondary"
                disabled={form.busy}
                onClick={() => setRevoking(null)}
              >
                Cancelar
              </button>
              <button
                className="button danger"
                disabled={form.busy}
                onClick={revoke}
              >
                {form.busy ? "Revocando…" : "Revocar enlace"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export function DriversPage({ onNotify }: PageProps) {
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const [tab, setTab] = useState("drivers");
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const [passwordDriver, setPasswordDriver] = useState<Driver | null>(null);
  const [inviting, setInviting] = useState(false);
  const [revision, setRevision] = useState(0);
  const pageSize = usePageSize(430, 86);
  const paged = usePagination(drivers.data?.items || [], pageSize);
  return (
    <div className="admin-page">
      <PageHeading
        title="Equipo"
        action={
          <div className="admin-heading-actions">
            {tab === "drivers" && (
              <button
                className="button secondary"
                onClick={() => setEditing("new")}
              >
                <Plus size={18} />
                Agregar chofer
              </button>
            )}
            <button
              className="button primary"
              onClick={() => setInviting(true)}
            >
              <Link2 size={18} />
              Invitar
            </button>
          </div>
        }
      />
      <div className="admin-tabs" aria-label="Equipo y accesos">
        <button
          className={tab === "drivers" ? "active" : ""}
          aria-pressed={tab === "drivers"}
          onClick={() => setTab("drivers")}
        >
          Choferes <span>{drivers.data?.items.length ?? "—"}</span>
        </button>
        <button
          className={tab === "invitations" ? "active" : ""}
          aria-pressed={tab === "invitations"}
          onClick={() => setTab("invitations")}
        >
          Invitaciones
        </button>
      </div>
      <LoadState
        loading={drivers.loading && !drivers.data}
        error={drivers.error || trucks.error}
        retry={() => {
          drivers.reload();
          trucks.reload();
        }}
      />
      {tab === "drivers" && drivers.data && !drivers.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-driver-row">
            <span>Chofer</span>
            <span>Camión habitual</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {paged.items.map((driver) => (
            <article
              className="admin-record-row admin-driver-row"
              key={driver.id}
            >
              <div className="admin-row-identity">
                <span className="admin-avatar">
                  {driver.name
                    .split(" ")
                    .slice(0, 2)
                    .map((name) => name[0])
                    .join("")}
                </span>
                <div>
                  <h2>{driver.name}</h2>
                  <p>
                    {driver.username}
                    {driver.phone && (
                      <>
                        {" "}
                        · <a href={`tel:${driver.phone}`}>{driver.phone}</a>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <span className="admin-row-secondary">
                {trucks.data?.items.find(
                  (truck) => truck.id === driver.assignedTruckId,
                )?.plate || "Sin asignar"}
              </span>
              <span
                className={`badge ${driver.active ? "success" : "neutral"}`}
              >
                {driver.active ? "Activo" : "Inactivo"}
              </span>
              <div className="admin-row-actions">
                <button
                  className="button ghost"
                  onClick={() => setEditing(driver)}
                >
                  <Pencil size={17} />
                  Editar
                </button>
                <button
                  className="button ghost"
                  onClick={() => setPasswordDriver(driver)}
                >
                  Restablecer acceso
                </button>
              </div>
            </article>
          ))}
          {!drivers.data.items.length && (
            <EmptyState
              title="Todavía no hay choferes"
              description="Agregá un chofer o enviale una invitación."
            />
          )}
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={drivers.data.items.length}
            onPage={paged.setPage}
          />
        </section>
      )}
      {tab === "invitations" && (
        <InvitationsPanel revision={revision} onNotify={onNotify} />
      )}
      {editing && (
        <DriverForm
          driver={editing === "new" ? null : editing}
          trucks={trucks.data?.items || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            drivers.reload();
            onNotify(
              editing === "new"
                ? "Acceso del chofer creado"
                : "Chofer actualizado",
            );
          }}
        />
      )}
      {passwordDriver && (
        <PasswordForm
          driver={passwordDriver}
          onClose={() => setPasswordDriver(null)}
          onSaved={() => {
            setPasswordDriver(null);
            onNotify(
              "Acceso restablecido. Compartí la contraseña provisoria con el chofer.",
            );
          }}
        />
      )}
      {inviting && (
        <InvitationForm
          drivers={drivers.data?.items || []}
          onClose={() => setInviting(false)}
          onSaved={() => {
            setRevision((value) => value + 1);
            setTab("invitations");
          }}
        />
      )}
    </div>
  );
}

function addMonths(date: string, months: number): string {
  if (
    !/^\d{4}-\d{2}-\d{2}/.test(date) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 120
  )
    return "";
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const lastDay = new Date(
    Date.UTC(year, month - 1 + months + 1, 0),
  ).getUTCDate();
  const result = new Date(
    Date.UTC(year, month - 1 + months, Math.min(day, lastDay)),
  );
  return result.toISOString().slice(0, 10);
}

function FormSteps({ labels, step }: { labels: string[]; step: number }) {
  return (
    <ol className="admin-form-steps" aria-label="Pasos del formulario">
      {labels.map((label, index) => (
        <li
          key={label}
          className={
            index === step ? "current" : index < step ? "complete" : ""
          }
          aria-current={index === step ? "step" : undefined}
        >
          <span>{index < step ? <Check size={14} /> : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
function StepFooter({
  step,
  finalStep,
  busy,
  onBack,
  onClose,
  label,
}: {
  step: number;
  finalStep: number;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  label: string;
}) {
  return (
    <div className="admin-form-footer">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={step ? onBack : onClose}
      >
        {step ? <ChevronLeft size={18} /> : null}
        {step ? "Volver" : "Cancelar"}
      </button>
      <button className="button primary" disabled={busy}>
        {busy ? "Guardando…" : step === finalStep ? label : "Continuar"}
        {!busy &&
          (step === finalStep ? <Check size={18} /> : <ArrowRight size={18} />)}
      </button>
    </div>
  );
}
function ObligationForm({
  obligation,
  trucks,
  drivers,
  defaults,
  onClose,
  onSaved,
}: {
  obligation: Obligation | null;
  trucks: Truck[];
  drivers: Driver[];
  defaults: Settings | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<"SERVICE" | "DOCUMENT">(
    obligation?.kind || "SERVICE",
  );
  const [title, setTitle] = useState(obligation?.title || "");
  const [ownerType, setOwnerType] = useState<"truck" | "driver">(
    obligation?.driverId ? "driver" : "truck",
  );
  const [ownerId, setOwnerId] = useState(
    obligation?.truckId || obligation?.driverId || "",
  );
  const [dueDate, setDueDate] = useState(
    obligation?.dueDate?.slice(0, 10) || "",
  );
  const [dueKm, setDueKm] = useState(obligation?.dueKm?.toString() || "");
  const [intervalMonths, setIntervalMonths] = useState(
    obligation?.intervalMonths?.toString() || "",
  );
  const [intervalKm, setIntervalKm] = useState(
    obligation?.intervalKm?.toString() || "",
  );
  const [warningDays, setWarningDays] = useState(
    String(obligation?.warningDays ?? defaults?.warningDays ?? 30),
  );
  const [warningKm, setWarningKm] = useState(
    String(obligation?.warningKm ?? defaults?.warningKm ?? 1000),
  );
  const [notes, setNotes] = useState(obligation?.notes || "");
  const [active, setActive] = useState(obligation?.active ?? true);
  const [initialRecord, setInitialRecord] = useState(false);
  const [performedAt, setPerformedAt] = useState(dateTimeInput());
  const [odometer, setOdometer] = useState("");
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    form.begin();
    try {
      await send(
        obligation ? `/obligations/${obligation.id}` : "/obligations",
        obligation ? "PATCH" : "POST",
        {
          title: title.trim(),
          kind,
          truckId: ownerType === "truck" ? ownerId : null,
          driverId: ownerType === "driver" ? ownerId : null,
          dueDate: dueDate || null,
          dueKm: ownerType === "truck" ? optionalNumber(dueKm) : null,
          intervalMonths: optionalNumber(intervalMonths),
          intervalKm: ownerType === "truck" ? optionalNumber(intervalKm) : null,
          warningDays: Number(warningDays),
          warningKm: Number(warningKm),
          notes: notes.trim() || null,
          ...(obligation ? { active, version: obligation.version } : {}),
          ...(!obligation && kind === "SERVICE" && initialRecord
            ? {
                initialRecord: {
                  performedAt: businessInstant(performedAt),
                  odometer: optionalNumber(odometer),
                },
              }
            : {}),
        },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
      if (error instanceof ApiError) {
        const fields = Object.keys(error.fields);
        if (
          fields.some((key) =>
            ["title", "kind", "truckId", "driverId", "notes"].includes(key),
          )
        )
          setStep(0);
        else if (
          fields.some((key) =>
            [
              "dueDate",
              "dueKm",
              "intervalMonths",
              "intervalKm",
              "warningDays",
              "warningKm",
            ].includes(key),
          )
        )
          setStep(1);
      }
    }
  }
  const ownerName =
    ownerType === "truck"
      ? trucks.find((item) => item.id === ownerId)?.plate
      : drivers.find((item) => item.id === ownerId)?.name;
  return (
    <Modal
      title={obligation ? "Editar vencimiento" : "Agregar vencimiento"}
      wide
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form admin-step-form" onSubmit={submit}>
        <FormSteps
          labels={["Datos", "Programación", "Confirmación"]}
          step={step}
        />
        <FormError message={form.message} />
        <div className="admin-step-content" key={step}>
          {step === 0 && (
            <>
              {!obligation && (
                <div
                  className="admin-type-picker"
                  role="group"
                  aria-label="Tipo de vencimiento"
                >
                  <button
                    type="button"
                    className={kind === "SERVICE" ? "selected" : ""}
                    aria-pressed={kind === "SERVICE"}
                    onClick={() => {
                      setKind("SERVICE");
                      if (ownerType !== "truck") {
                        setOwnerType("truck");
                        setOwnerId("");
                      }
                    }}
                  >
                    <Wrench size={19} />
                    Servicio{kind === "SERVICE" && <Check size={16} />}
                  </button>
                  <button
                    type="button"
                    className={kind === "DOCUMENT" ? "selected" : ""}
                    aria-pressed={kind === "DOCUMENT"}
                    onClick={() => setKind("DOCUMENT")}
                  >
                    <FileCheck2 size={19} />
                    Documento{kind === "DOCUMENT" && <Check size={16} />}
                  </button>
                </div>
              )}
              <Field label="Nombre" error={form.fields.title}>
                <input
                  required
                  maxLength={120}
                  placeholder={
                    kind === "SERVICE"
                      ? "Ej. Cambio de aceite y filtros"
                      : "Ej. Seguro del camión"
                  }
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <div className="grid2">
                <Field label="Corresponde a">
                  <select
                    value={ownerType}
                    disabled={!!obligation || kind === "SERVICE"}
                    onChange={(event) => {
                      setOwnerType(event.target.value as "truck" | "driver");
                      setOwnerId("");
                    }}
                  >
                    <option value="truck">Un camión</option>
                    <option value="driver">Un chofer</option>
                  </select>
                </Field>
                <Field
                  label={ownerType === "truck" ? "Camión" : "Chofer"}
                  error={form.fields.truckId || form.fields.driverId}
                >
                  <select
                    required
                    disabled={!!obligation}
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    {ownerType === "truck"
                      ? trucks
                          .filter((item) => item.active || item.id === ownerId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.plate} · {item.label}
                            </option>
                          ))
                      : drivers
                          .filter((item) => item.active || item.id === ownerId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                  </select>
                </Field>
              </div>
              <Field label="Observaciones (opcional)" error={form.fields.notes}>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </>
          )}
          {step === 1 && (
            <>
              <div className="grid2">
                <Field
                  label="Fecha límite (opcional)"
                  error={form.fields.dueDate}
                >
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </Field>
                {ownerType === "truck" && (
                  <Field
                    label="Odómetro límite (opcional)"
                    error={form.fields.dueKm}
                  >
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      placeholder="Ej. 450000"
                      value={dueKm}
                      onChange={(event) => setDueKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              <p className="admin-field-note">
                {dueDate || (ownerType === "truck" && dueKm)
                  ? "Se avisa al alcanzar cualquiera de los límites. El odómetro es la lectura total, no los kilómetros restantes."
                  : "Sin un límite, quedará pendiente de configurar."}
              </p>
              <div className="grid2">
                <Field
                  label="Repetir cada… meses (opcional)"
                  error={form.fields.intervalMonths}
                >
                  <input
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    inputMode="numeric"
                    value={intervalMonths}
                    onChange={(event) => setIntervalMonths(event.target.value)}
                  />
                </Field>
                {ownerType === "truck" && (
                  <Field
                    label="Repetir cada… km (opcional)"
                    error={form.fields.intervalKm}
                  >
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={intervalKm}
                      onChange={(event) => setIntervalKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              <div className="grid2">
                <Field
                  label="Avisar con… días de anticipación"
                  error={form.fields.warningDays}
                >
                  <input
                    required
                    type="number"
                    min="0"
                    max="365"
                    step="1"
                    inputMode="numeric"
                    value={warningDays}
                    onChange={(event) => setWarningDays(event.target.value)}
                  />
                </Field>
                {ownerType === "truck" && (
                  <Field
                    label="Avisar con… km de anticipación"
                    error={form.fields.warningKm}
                  >
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={warningKm}
                      onChange={(event) => setWarningKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <dl className="admin-confirmation">
                <div>
                  <dt>{ownerName}</dt>
                  <dd>{title}</dd>
                </div>
                <div>
                  <dt>Próximo vencimiento</dt>
                  <dd>
                    {[
                      dueDate ? dateLabel(dueDate) : null,
                      ownerType === "truck" && dueKm
                        ? `${formatKm(Number(dueKm))} km`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Pendiente de configurar"}
                  </dd>
                </div>
              </dl>
              {!obligation && kind === "SERVICE" && (
                <>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={initialRecord}
                      onChange={(event) =>
                        setInitialRecord(event.target.checked)
                      }
                    />
                    <span>Registrar también el último servicio</span>
                  </label>
                  {initialRecord && (
                    <>
                      <div className="grid2">
                        <Field
                          label="Fecha y hora del servicio"
                          error={form.fields["initialRecord.performedAt"]}
                        >
                          <input
                            required
                            type="datetime-local"
                            value={performedAt}
                            max={dateTimeInput()}
                            onChange={(event) =>
                              setPerformedAt(event.target.value)
                            }
                          />
                        </Field>
                        <Field
                          label="Odómetro de ese servicio"
                          error={form.fields["initialRecord.odometer"]}
                        >
                          <input
                            required
                            type="number"
                            min="0"
                            step="1"
                            inputMode="numeric"
                            value={odometer}
                            onChange={(event) =>
                              setOdometer(event.target.value)
                            }
                          />
                        </Field>
                      </div>
                      {(intervalMonths || intervalKm) && (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={!performedAt || (!!intervalKm && !odometer)}
                          onClick={() => {
                            if (intervalMonths)
                              setDueDate(
                                addMonths(performedAt, Number(intervalMonths)),
                              );
                            if (intervalKm && odometer)
                              setDueKm(
                                String(Number(odometer) + Number(intervalKm)),
                              );
                          }}
                        >
                          Calcular próximo límite
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {obligation && (
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                  />
                  <span>
                    <strong>Seguimiento activo</strong>
                    <small>
                      Al desactivarlo se detienen los avisos. El historial se
                      conserva.
                    </small>
                  </span>
                </label>
              )}
            </>
          )}
        </div>
        <StepFooter
          step={step}
          finalStep={2}
          busy={form.busy}
          onBack={() => setStep(step - 1)}
          onClose={onClose}
          label={obligation ? "Guardar cambios" : "Agregar vencimiento"}
        />
      </form>
    </Modal>
  );
}

function RenewalForm({
  obligation,
  onClose,
  onSaved,
}: {
  obligation: Obligation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState(0);
  const [performedAt, setPerformedAt] = useState(dateTimeInput());
  const [odometer, setOdometer] = useState("");
  const [nextDueDate, setNextDueDate] = useState(
    obligation.intervalMonths
      ? addMonths(dateToday(), obligation.intervalMonths)
      : "",
  );
  const [nextDueKm, setNextDueKm] = useState("");
  const [notes, setNotes] = useState("");
  const form = useFormStatus();
  const service = obligation.kind === "SERVICE";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    if (step === 0) {
      setStep(1);
      return;
    }
    form.begin();
    try {
      await send(`/obligations/${obligation.id}/renewals`, "POST", {
        performedAt: businessInstant(performedAt),
        odometer: service ? optionalNumber(odometer) : null,
        nextDueDate: nextDueDate || null,
        nextDueKm: obligation.truckId ? optionalNumber(nextDueKm) : null,
        notes: notes.trim() || null,
        version: obligation.version,
      });
      onSaved();
    } catch (error) {
      form.fail(error);
      if (
        error instanceof ApiError &&
        Object.keys(error.fields).some((key) =>
          ["performedAt", "odometer", "notes"].includes(key),
        )
      )
        setStep(0);
    }
  }
  return (
    <Modal
      title={service ? "Registrar servicio" : "Renovar documento"}
      wide
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form admin-step-form" onSubmit={submit}>
        <FormSteps labels={["Registro", "Próximo vencimiento"]} step={step} />
        <div className="admin-renewal-context">
          <strong>{obligation.title}</strong>
          <OwnerLabel obligation={obligation} />
        </div>
        <FormError message={form.message} />
        <div className="admin-step-content" key={step}>
          {step === 0 ? (
            <>
              <div className="grid2">
                <Field
                  label={
                    service
                      ? "Fecha y hora del servicio"
                      : "Fecha y hora de renovación"
                  }
                  error={form.fields.performedAt}
                >
                  <input
                    required
                    type="datetime-local"
                    max={dateTimeInput()}
                    value={performedAt}
                    onChange={(event) => setPerformedAt(event.target.value)}
                  />
                </Field>
                {service && (
                  <Field
                    label="Odómetro del servicio"
                    error={form.fields.odometer}
                    hint={
                      obligation.truck
                        ? `Última lectura: ${formatKm(obligation.truck.odometer)} km (${dateLabel(obligation.truck.odometerAt)}).`
                        : undefined
                    }
                  >
                    <input
                      required
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={odometer}
                      onChange={(event) => setOdometer(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              <Field label="Observaciones (opcional)" error={form.fields.notes}>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="grid2">
                <Field
                  label="Próxima fecha (opcional)"
                  error={form.fields.nextDueDate}
                >
                  <input
                    type="date"
                    min={performedAt.slice(0, 10)}
                    value={nextDueDate}
                    onChange={(event) => setNextDueDate(event.target.value)}
                  />
                </Field>
                {obligation.truckId && (
                  <Field
                    label="Próximo odómetro (opcional)"
                    error={form.fields.nextDueKm}
                  >
                    <input
                      type="number"
                      inputMode="numeric"
                      min={odometer ? Number(odometer) + 1 : 0}
                      step="1"
                      value={nextDueKm}
                      onChange={(event) => setNextDueKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              {(obligation.intervalMonths || obligation.intervalKm) && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    if (obligation.intervalMonths)
                      setNextDueDate(
                        addMonths(performedAt, obligation.intervalMonths),
                      );
                    if (obligation.intervalKm && odometer)
                      setNextDueKm(
                        String(Number(odometer) + obligation.intervalKm),
                      );
                  }}
                >
                  Sugerir según la frecuencia
                </button>
              )}
              <p className="admin-field-note">
                {nextDueDate || nextDueKm
                  ? "Confirmá estos límites. El registro anterior se conserva en el historial."
                  : "Sin un próximo límite, quedará pendiente de configurar."}
              </p>
              <dl className="admin-confirmation">
                <div>
                  <dt>
                    {service ? "Servicio realizado" : "Documento renovado"}
                  </dt>
                  <dd>
                    {dateLabel(businessInstant(performedAt))}
                    {service && odometer
                      ? ` · ${formatKm(Number(odometer))} km`
                      : ""}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
        <StepFooter
          step={step}
          finalStep={1}
          busy={form.busy}
          onBack={() => setStep(0)}
          onClose={onClose}
          label={service ? "Confirmar servicio" : "Confirmar renovación"}
        />
      </form>
    </Modal>
  );
}

function HistoryModal({
  obligation,
  onClose,
}: {
  obligation: Obligation;
  onClose: () => void;
}) {
  const history = useLoad<{ items: Renewal[] }>(
    `/obligations/${obligation.id}/renewals`,
  );
  const pageSize = 3;
  const paged = usePagination(history.data?.items || [], pageSize);
  return (
    <Modal title="Historial de renovaciones" onClose={onClose}>
      <div className="admin-history-body">
        <div className="admin-history-title">
          <strong>{obligation.title}</strong>
          <OwnerLabel obligation={obligation} />
        </div>
        <LoadState
          loading={history.loading}
          error={history.error}
          retry={history.reload}
        />
        {history.data?.items.length ? (
          <ol className="admin-timeline">
            {paged.items.map((item) => (
              <li key={item.id}>
                <span className="admin-timeline-dot">
                  <Check size={13} />
                </span>
                <div>
                  <strong>{dateLabel(item.performedAt)}</strong>
                  {item.odometer !== null && (
                    <span className="admin-history-km">
                      {formatKm(item.odometer)} km
                    </span>
                  )}
                  {item.notes && <p>{item.notes}</p>}
                  <div className="admin-history-next">
                    <small>Próximo límite registrado</small>
                    <span>
                      {[
                        item.nextDueDate ? dateLabel(item.nextDueDate) : null,
                        item.nextDueKm !== null
                          ? `${formatKm(item.nextDueKm)} km`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sin definir"}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          !history.loading &&
          !history.error && (
            <EmptyState
              title="Todavía no hay renovaciones"
              description="Los servicios y las renovaciones que registres se guardarán acá."
            />
          )
        )}
        {history.data && (
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={history.data.items.length}
            onPage={paged.setPage}
          />
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

export function ObligationsPage({ onNotify }: PageProps) {
  const state = useLoad<{ items: Obligation[] }>("/obligations");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const settings = useLoad<Settings>("/settings");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Obligation | "new" | null>(null);
  const [renewing, setRenewing] = useState<Obligation | null>(null);
  const [history, setHistory] = useState<Obligation | null>(null);
  const active = state.data?.items.filter((item) => item.active) || [];
  const counts = {
    all: active.length,
    attention: active.filter(
      (item) =>
        item.status === "OVERDUE" ||
        item.status === "UPCOMING" ||
        item.status === "UNCONFIGURED",
    ).length,
    service: active.filter((item) => item.kind === "SERVICE").length,
    document: active.filter((item) => item.kind === "DOCUMENT").length,
  };
  const filtered = (state.data?.items || [])
    .filter(
      (item) =>
        (showInactive || item.active) &&
        (filter === "all" ||
          (filter === "attention" && item.status !== "OK") ||
          (filter === "service" && item.kind === "SERVICE") ||
          (filter === "document" && item.kind === "DOCUMENT")) &&
        `${item.title} ${item.truck?.plate || ""} ${item.driver?.name || ""}`
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .includes(
            search
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase(),
          ),
    )
    .sort(
      (a, b) =>
        ({ OVERDUE: 0, UPCOMING: 1, UNCONFIGURED: 2, OK: 3 })[a.status] -
        { OVERDUE: 0, UPCOMING: 1, UNCONFIGURED: 2, OK: 3 }[b.status],
    );
  const reloadAll = () => {
    state.reload();
    trucks.reload();
    drivers.reload();
    settings.reload();
  };
  const pageSize = usePageSize(425, 84);
  const paged = usePagination(
    filtered,
    pageSize,
    `${filter}-${search}-${showInactive}`,
  );
  return (
    <div className="admin-page">
      <PageHeading
        title="Vencimientos"
        action={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={19} />
            Agregar vencimiento
          </button>
        }
      />
      <div className="admin-tabs" aria-label="Filtrar vencimientos">
        {(
          [
            ["all", "Todos"],
            ["attention", "Pendientes"],
            ["service", "Servicios"],
            ["document", "Documentos"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span>{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="admin-obligation-search">
        <Field label="Buscar por nombre, patente o chofer">
          <input
            type="search"
            placeholder="Buscar vencimiento…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          <span>Incluir inactivos</span>
        </label>
      </div>
      <LoadState
        loading={state.loading && !state.data}
        error={state.error || trucks.error || drivers.error || settings.error}
        retry={reloadAll}
      />
      {state.data && !state.error && (
        <section className="admin-surface admin-records admin-obligation-records">
          <div className="admin-list-header admin-obligation-row">
            <span>Servicio o documento</span>
            <span>Próximo límite</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {paged.items.map((item) => (
            <article
              key={item.id}
              className={`admin-record-row admin-obligation-row ${!item.active ? "is-inactive" : ""}`}
            >
              <div className="admin-row-identity">
                <span
                  className={`admin-item-symbol ${item.status.toLowerCase()}`}
                >
                  {item.kind === "SERVICE" ? (
                    <Wrench size={21} />
                  ) : (
                    <FileCheck2 size={21} />
                  )}
                </span>
                <div>
                  <h2>{item.title}</h2>
                  <OwnerLabel obligation={item} />
                </div>
              </div>
              <div className="admin-obligation-limit">
                <DueSummary obligation={item} />
                <small>
                  {item.status === "UNCONFIGURED"
                    ? "Pendiente de configurar"
                    : [
                        item.daysRemaining !== null
                          ? item.daysRemaining < 0
                            ? `Hace ${Math.abs(item.daysRemaining)} días`
                            : item.daysRemaining === 0
                              ? "Vence hoy"
                              : `En ${item.daysRemaining} días`
                          : null,
                        item.kmRemaining !== null
                          ? item.kmRemaining <= 0
                            ? `${formatKm(Math.abs(item.kmRemaining))} km sobre el límite`
                            : `Faltan ${formatKm(item.kmRemaining)} km`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </small>
              </div>
              <div className="admin-row-status">
                <StatusBadge status={item.status} />
                {!item.active && <small>Inactivo</small>}
              </div>
              <div className="admin-row-actions">
                <button
                  className="button ghost admin-icon-button"
                  aria-label={`Historial de ${item.title}`}
                  title="Historial"
                  onClick={() => setHistory(item)}
                >
                  <History size={19} />
                </button>
                <button
                  className="button ghost admin-icon-button"
                  aria-label={`Editar ${item.title}`}
                  title="Editar"
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={18} />
                </button>
                {item.active && (
                  <button
                    className="button secondary"
                    onClick={() => setRenewing(item)}
                  >
                    {item.kind === "SERVICE" ? "Registrar servicio" : "Renovar"}
                  </button>
                )}
              </div>
            </article>
          ))}
          {!filtered.length && (
            <EmptyState
              title={
                state.data.items.length
                  ? "No hay resultados"
                  : "Todavía no hay vencimientos"
              }
              description={
                state.data.items.length
                  ? "Cambiá los filtros o el texto de búsqueda."
                  : "Agregá un servicio o documento para comenzar."
              }
            />
          )}
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={filtered.length}
            onPage={paged.setPage}
          />
        </section>
      )}
      {editing && (
        <ObligationForm
          obligation={editing === "new" ? null : editing}
          trucks={trucks.data?.items || []}
          drivers={drivers.data?.items || []}
          defaults={settings.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
            onNotify(
              editing === "new"
                ? "Vencimiento agregado"
                : "Vencimiento actualizado",
            );
          }}
        />
      )}
      {renewing && (
        <RenewalForm
          obligation={renewing}
          onClose={() => setRenewing(null)}
          onSaved={() => {
            setRenewing(null);
            reloadAll();
            onNotify(
              "Registro guardado. El próximo vencimiento ya está actualizado.",
            );
          }}
        />
      )}
      {history && (
        <HistoryModal obligation={history} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

export function ReportsPage({ onNotify }: PageProps) {
  const today = dateToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const pageSize = usePageSize(530, 76);
  useEffect(() => setPage(1), [pageSize]);
  const query = new URLSearchParams({
    from,
    to,
    page: String(page),
    pageSize: String(pageSize),
    ...(driverId ? { driverId } : {}),
    ...(truckId ? { truckId } : {}),
  });
  const state = useLoad<TripList>(`/trips?${query}`);
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  function change(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }
  async function download() {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/trips/export?${query}`, {
        credentials: "same-origin",
        headers: { "X-Tomasini-Request": "1" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message || "No pudimos generar el archivo.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Tomasini-viajes-${from}-${to}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      onNotify("El archivo de Excel está listo para descargar.");
    } catch (error) {
      onNotify(err(error), "error");
    } finally {
      setExporting(false);
    }
  }
  const invalidDates = !from || !to || from > to;
  const disabled =
    invalidDates ||
    !state.data?.total ||
    !!state.error ||
    state.loading ||
    exporting;
  return (
    <div className="admin-page">
      <PageHeading
        title="Reportes"
        action={
          <button
            className="button primary"
            disabled={disabled}
            onClick={download}
          >
            <ArrowDownToLine size={19} />
            {exporting ? "Preparando Excel…" : "Descargar Excel"}
          </button>
        }
      />
      <section className="admin-report-filters">
        <div className="admin-report-fields">
          <Field label="Desde">
            <input
              type="date"
              required
              value={from}
              max={to || undefined}
              onChange={(event) => change(setFrom, event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              required
              value={to}
              min={from || undefined}
              onChange={(event) => change(setTo, event.target.value)}
            />
          </Field>
          <Field label="Chofer">
            <select
              value={driverId}
              onChange={(event) => change(setDriverId, event.target.value)}
            >
              <option value="">Todos los choferes</option>
              {drivers.data?.items.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name}
                  {!driver.active ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Camión">
            <select
              value={truckId}
              onChange={(event) => change(setTruckId, event.target.value)}
            >
              <option value="">Todos los camiones</option>
              {trucks.data?.items.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate}
                  {!truck.active ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>
      <LoadState
        loading={state.loading && !state.data}
        error={state.error || drivers.error || trucks.error}
        retry={() => {
          state.reload();
          drivers.reload();
          trucks.reload();
        }}
      />
      {state.data && !state.error && (
        <>
          <div className="admin-report-totals" aria-live="polite">
            <div>
              <span>Viajes del período</span>
              <strong>{state.data.totals.count}</strong>
            </div>
            <div>
              <span>Kilómetros recorridos</span>
              <strong>
                {formatKm(state.data.totals.distanceKm)} <small>km</small>
              </strong>
            </div>
            <div>
              <span>Viáticos</span>
              <strong>{formatMoney(state.data.totals.allowance)}</strong>
            </div>
          </div>
          <section
            className="admin-surface admin-report-results"
            aria-busy={state.loading}
          >
            {state.data.items.length ? (
              <>
                <div className="table-wrap admin-desktop-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Recorrido</th>
                        <th>Chofer / camión</th>
                        <th className="numeric">Kilómetros</th>
                        <th className="numeric">Viáticos</th>
                        <th>Revisión</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.items.map((trip) => (
                        <tr key={trip.id}>
                          <td>{dateLabel(trip.departureAt)}</td>
                          <td>
                            <span className="admin-report-route">
                              {trip.origin}
                              <ArrowRight size={14} />
                              {trip.destination}
                            </span>
                          </td>
                          <td>
                            <strong>{trip.driver.name}</strong>
                            <small>{trip.truck.plate}</small>
                          </td>
                          <td className="numeric">
                            {formatKm(trip.distanceKm)}
                          </td>
                          <td className="numeric">
                            {trip.allowance === null
                              ? "—"
                              : formatMoney(trip.allowance)}
                          </td>
                          <td>
                            <span
                              className={`badge ${trip.reviewedAt ? "success" : "neutral"}`}
                            >
                              {trip.reviewedAt ? "Revisado" : "Pendiente"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="admin-mobile-reports">
                  {state.data.items.map((trip) => (
                    <article key={trip.id}>
                      <div>
                        <span>{dateLabel(trip.departureAt)}</span>
                        <span
                          className={`badge ${trip.reviewedAt ? "success" : "neutral"}`}
                        >
                          {trip.reviewedAt ? "Revisado" : "Pendiente"}
                        </span>
                      </div>
                      <h3>
                        {trip.origin}
                        <ArrowRight size={15} />
                        {trip.destination}
                      </h3>
                      <p>
                        {trip.driver.name} · {trip.truck.plate}
                      </p>
                      <footer>
                        <strong>{formatKm(trip.distanceKm)} km</strong>
                        <span>
                          Viáticos:{" "}
                          {trip.allowance === null
                            ? "Sin registrar"
                            : formatMoney(trip.allowance)}
                        </span>
                      </footer>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                title="No hay viajes en este período"
                description="Elegí otras fechas o probá sin filtrar por chofer y camión."
              />
            )}
            <Pagination
              page={page}
              pageSize={state.data.pageSize}
              total={state.data.total}
              onPage={setPage}
              busy={state.loading}
            />
          </section>
        </>
      )}
    </div>
  );
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => void;
}) {
  const [recipientEmail, setRecipientEmail] = useState(
    settings.recipientEmail || "",
  );
  const [warningDays, setWarningDays] = useState(String(settings.warningDays));
  const [warningKm, setWarningKm] = useState(String(settings.warningKm));
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send("/settings", "PATCH", {
        recipientEmail: recipientEmail.trim() || null,
        warningDays: Number(warningDays),
        warningKm: Number(warningKm),
      });
      form.setBusy(false);
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <form
      className="admin-surface admin-settings-form admin-form"
      onSubmit={submit}
    >
      <FormError message={form.message} />
      <section className="admin-setting-section">
        <div>
          <h2>Correo de avisos</h2>
          <p>A las 08:00 de Argentina, cuando haya pendientes.</p>
        </div>
        <div className="admin-setting-fields">
          <Field label="Destinatario" error={form.fields.recipientEmail}>
            <input
              type="email"
              autoComplete="email"
              placeholder="nombre@correo.com"
              value={recipientEmail}
              maxLength={254}
              onChange={(event) => setRecipientEmail(event.target.value)}
            />
          </Field>
          <div
            className={`admin-mail-status ${settings.smtpConfigured ? "configured" : ""}`}
          >
            {settings.smtpConfigured ? (
              <CheckCircle2 size={18} />
            ) : (
              <CircleAlert size={18} />
            )}
            <span>
              {settings.smtpConfigured
                ? "Envío configurado"
                : "Falta configurar la cuenta de envío"}
            </span>
          </div>
        </div>
      </section>
      <section className="admin-setting-section">
        <div>
          <h2>Anticipación de avisos</h2>
          <p>Valores iniciales para nuevos vencimientos.</p>
        </div>
        <div className="admin-setting-fields grid2">
          <Field label="Días antes" error={form.fields.warningDays}>
            <input
              required
              type="number"
              min="0"
              max="365"
              inputMode="numeric"
              value={warningDays}
              onChange={(event) => setWarningDays(event.target.value)}
            />
          </Field>
          <Field label="Kilómetros antes" error={form.fields.warningKm}>
            <input
              required
              type="number"
              min="0"
              inputMode="numeric"
              value={warningKm}
              onChange={(event) => setWarningKm(event.target.value)}
            />
          </Field>
        </div>
      </section>
      <div className="admin-form-footer">
        <button className="button primary" disabled={form.busy}>
          {form.busy ? "Guardando…" : "Guardar preferencias"}
          {!form.busy && <Check size={18} />}
        </button>
      </div>
    </form>
  );
}
export function SettingsPage({ onNotify }: PageProps) {
  const settings = useLoad<Settings>("/settings");
  const notifications = useLoad<{ items: Notification[] }>("/notifications");
  const [tab, setTab] = useState("settings");
  const pageSize = usePageSize(430, 100);
  const paged = usePagination(notifications.data?.items || [], pageSize);
  return (
    <div className="admin-page">
      <PageHeading title="Preferencias" />
      <div className="admin-tabs" aria-label="Preferencias e historial">
        <button
          className={tab === "settings" ? "active" : ""}
          aria-pressed={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          Avisos
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          aria-pressed={tab === "history"}
          onClick={() => setTab("history")}
        >
          Historial de correos
        </button>
      </div>
      {tab === "settings" ? (
        <>
          <LoadState
            loading={settings.loading && !settings.data}
            error={settings.error}
            retry={settings.reload}
          />
          {settings.data && !settings.error && (
            <SettingsForm
              key={`${settings.data.recipientEmail}-${settings.data.warningDays}-${settings.data.warningKm}`}
              settings={settings.data}
              onSaved={() => {
                settings.reload();
                onNotify("Preferencias guardadas");
              }}
            />
          )}
        </>
      ) : (
        <>
          <LoadState
            loading={notifications.loading && !notifications.data}
            error={notifications.error}
            retry={notifications.reload}
          />
          {notifications.data && !notifications.error && (
            <section className="admin-surface admin-records">
              <div className="admin-section-toolbar">
                <span className="admin-result-count">
                  {notifications.data.items.length} envíos
                </span>
                <button className="button ghost" onClick={notifications.reload}>
                  <RefreshCw size={17} />
                  Actualizar
                </button>
              </div>
              <div className="admin-notification-list">
                {paged.items.map((item) => (
                  <article key={item.id}>
                    <div className="admin-notification-date">
                      <strong>{dateLabel(item.date)}</strong>
                      <small>
                        {item.sentAt
                          ? formatDate(item.sentAt, true)
                          : `${item.attempts} ${item.attempts === 1 ? "intento" : "intentos"}`}
                      </small>
                    </div>
                    <div className="admin-notification-detail">
                      <p>{item.recipient}</p>
                      {item.error && (
                        <p className="admin-notification-error">
                          {item.status === "FAILED"
                            ? "Se agotaron los intentos. Revisá la cuenta de correo."
                            : item.status === "SUPERSEDED"
                              ? "Reemplazado por un resumen más reciente."
                              : item.status === "CANCELLED"
                                ? "Los pendientes ya fueron resueltos."
                                : "Pendiente de envío. Revisá la cuenta de correo."}
                        </p>
                      )}
                    </div>
                    <span
                      className={`badge ${item.status === "SENT" ? "success" : item.status === "FAILED" ? "danger" : "neutral"}`}
                    >
                      {statusText(item.status)}
                    </span>
                  </article>
                ))}
              </div>
              {!notifications.data.items.length && (
                <EmptyState
                  title="Todavía no hay envíos"
                  description="Los avisos enviados y fallidos aparecerán acá."
                  icon={<Mail size={26} />}
                />
              )}
              <Pagination
                page={paged.page}
                pageSize={pageSize}
                total={notifications.data.items.length}
                onPage={paged.setPage}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}

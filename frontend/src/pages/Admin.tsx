import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
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
  UsersRound,
  Wrench,
} from "lucide-react";
import { api, send, ApiError } from "../api";
import type {
  Dashboard,
  Driver,
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

function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading admin-page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </header>
  );
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

export function AdminDashboard({ user, onNavigate }: PageProps) {
  const state = useLoad<Dashboard>("/dashboard");
  const pending =
    state.data?.obligations.filter(
      (item) => item.active && item.status !== "OK",
    ) || [];
  const firstName = user.name.trim().split(" ")[0];
  return (
    <div className="admin-page">
      <PageHeading
        eyebrow="TRANSPORTE TOMASINI"
        title={`Todo a la vista, ${firstName}.`}
        description="Los viajes y el cuidado de tu flota, en un mismo lugar."
        action={
          <button
            className="button primary"
            onClick={() => onNavigate("new-trip")}
          >
            <Plus size={20} />
            Cargar viaje
          </button>
        }
      />
      <LoadState
        loading={state.loading && !state.data}
        error={state.error}
        retry={state.reload}
      />
      {state.data && (
        <>
          <div className="admin-overview">
            <section className="admin-month-card">
              <div className="admin-month-top">
                <span>Este mes, en movimiento</span>
                <Route size={23} />
              </div>
              <div className="admin-month-number">
                {formatKm(state.data.stats.kilometersThisMonth)}
                <span>km recorridos</span>
              </div>
              <div className="admin-month-bottom">
                <span>
                  <strong>{state.data.stats.tripsThisMonth}</strong> viajes
                  registrados
                </span>
                <button onClick={() => onNavigate("reports")}>
                  Ver resumen
                  <ArrowRight size={17} />
                </button>
              </div>
            </section>
            <button
              className="panel admin-stat-card"
              onClick={() => onNavigate("trips")}
            >
              <span className="admin-stat-icon">
                <FileCheck2 size={22} />
              </span>
              <strong>{state.data.stats.pendingReviews}</strong>
              <span>Viajes por revisar</span>
              <small>
                Revisar registros <ArrowRight size={15} />
              </small>
            </button>
            <button
              className={`panel admin-stat-card ${state.data.stats.overdue ? "attention" : ""}`}
              onClick={() => onNavigate("obligations")}
            >
              <span className="admin-stat-icon">
                <Bell size={22} />
              </span>
              <strong>{pending.length}</strong>
              <span>Vencimientos pendientes</span>
              <small>
                {state.data.stats.overdue
                  ? `${state.data.stats.overdue} vencidos · ${state.data.stats.upcoming} próximos`
                  : "Controlar próximos límites"}
                <ArrowRight size={15} />
              </small>
            </button>
          </div>
          <div className="admin-dashboard-columns">
            <section className="panel admin-section">
              <div className="admin-section-head">
                <div>
                  <p className="eyebrow">PREVENIR ES MÁS SIMPLE</p>
                  <h2>Lo que necesita atención</h2>
                </div>
                <button
                  className="button ghost"
                  onClick={() => onNavigate("obligations")}
                >
                  Ver todo
                  <ArrowRight size={16} />
                </button>
              </div>
              {pending.length ? (
                <div className="admin-attention-list">
                  {pending.slice(0, 5).map((item) => (
                    <button
                      key={item.id}
                      className="admin-attention-row"
                      onClick={() => onNavigate("obligations")}
                    >
                      <span
                        className={`admin-item-symbol ${item.status.toLowerCase()}`}
                      >
                        {item.kind === "SERVICE" ? (
                          <Wrench size={21} />
                        ) : (
                          <FileCheck2 size={21} />
                        )}
                      </span>
                      <span className="admin-item-content">
                        <strong>{item.title}</strong>
                        <OwnerLabel obligation={item} />
                        <DueSummary obligation={item} />
                      </span>
                      <StatusBadge status={item.status} />
                      <ChevronRight size={17} className="admin-row-arrow" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="admin-all-clear">
                  <span>
                    <ShieldCheck size={30} />
                  </span>
                  <h3>Todo bajo control</h3>
                  <p>
                    {state.data.obligations.length
                      ? "No hay vencimientos pendientes en este momento."
                      : "Agregá servicios y documentos para empezar a anticiparte."}
                  </p>
                  {!state.data.obligations.length && (
                    <button
                      className="button secondary"
                      onClick={() => onNavigate("obligations")}
                    >
                      Agregar vencimiento
                    </button>
                  )}
                </div>
              )}
            </section>
            <section className="panel admin-section">
              <div className="admin-section-head">
                <div>
                  <p className="eyebrow">CADA CAMIÓN, AL DÍA</p>
                  <h2>Tu flota</h2>
                </div>
                <button
                  className="button ghost"
                  onClick={() => onNavigate("fleet")}
                  aria-label="Ver la flota"
                >
                  <ArrowRight size={20} />
                </button>
              </div>
              <div className="admin-fleet-mini">
                {state.data.trucks
                  .filter((truck) => truck.active)
                  .map((truck) => (
                    <button
                      key={truck.id}
                      onClick={() => onNavigate("fleet")}
                      className="admin-fleet-mini-row"
                    >
                      <span className="admin-truck-symbol">
                        <TruckIcon size={29} strokeWidth={1.5} />
                      </span>
                      <span>
                        <strong>{truck.plate}</strong>
                        <small>{truck.label}</small>
                      </span>
                      <span className="admin-fleet-km">
                        <strong>{formatKm(truck.odometer)}</strong>
                        <small>km registrados</small>
                      </span>
                    </button>
                  ))}
                {!state.data.trucks.some((truck) => truck.active) && (
                  <EmptyState
                    title="Todavía no hay camiones"
                    description="Agregá la primera unidad para comenzar."
                  />
                )}
              </div>
            </section>
          </div>
          <section className="panel admin-section">
            <div className="admin-section-head">
              <div>
                <p className="eyebrow">ACTIVIDAD RECIENTE</p>
                <h2>Últimos viajes</h2>
              </div>
              <button
                className="button ghost"
                onClick={() => onNavigate("trips")}
              >
                Ver viajes
                <ArrowRight size={16} />
              </button>
            </div>
            {state.data.recentTrips.length ? (
              <div className="admin-recent-trips">
                {state.data.recentTrips.slice(0, 5).map((trip) => (
                  <button
                    className="admin-recent-trip"
                    onClick={() => onNavigate("trips")}
                    key={trip.id}
                  >
                    <span className="admin-route-icon">
                      <Route size={20} />
                    </span>
                    <span className="admin-trip-route">
                      <strong>
                        {trip.origin}
                        <ArrowRight size={14} />
                        {trip.destination}
                      </strong>
                      <small>
                        {trip.driver.name} · {trip.truck.plate}
                      </small>
                    </span>
                    <span className="admin-trip-date">
                      {dateLabel(trip.departureAt)}
                    </span>
                    <strong className="admin-trip-km">
                      {formatKm(trip.distanceKm)} <small>km</small>
                    </strong>
                    <span
                      className={`badge ${trip.reviewedAt ? "success" : "neutral"}`}
                    >
                      {trip.reviewedAt ? "Revisado" : "Por revisar"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="El primer viaje empieza acá"
                description="Cuando se carguen viajes, vas a encontrarlos en este resumen."
              />
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
        <p className="admin-form-intro">
          {truck
            ? "Los viajes y servicios anteriores se conservan."
            : "Identificá la unidad y registrá una lectura real de su odómetro."}
        </p>
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
  return (
    <div className="admin-page">
      <PageHeading
        eyebrow="LAS UNIDADES"
        title="Tu flota"
        description="El kilometraje y la información de cada camión."
        action={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={19} />
            Agregar camión
          </button>
        }
      />
      <LoadState
        loading={trucks.loading && !trucks.data}
        error={trucks.error || drivers.error}
        retry={() => {
          trucks.reload();
          drivers.reload();
        }}
      />
      <label className="admin-check admin-filter-check">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(event) => setShowInactive(event.target.checked)}
        />
        <span>Mostrar también camiones inactivos</span>
      </label>
      <div className="admin-fleet-grid">
        {items.map((truck) => {
          const assigned =
            drivers.data?.items.filter(
              (driver) => driver.active && driver.assignedTruckId === truck.id,
            ) || [];
          return (
            <article
              className={`panel admin-truck-card ${!truck.active ? "is-inactive" : ""}`}
              key={truck.id}
            >
              <div className="admin-truck-card-head">
                <span className="admin-truck-symbol">
                  <TruckIcon size={34} strokeWidth={1.5} />
                </span>
                <span
                  className={`badge ${truck.active ? "success" : "neutral"}`}
                >
                  {truck.active ? "Activo" : "Inactivo"}
                </span>
              </div>
              <h2>{truck.plate}</h2>
              <p className="admin-truck-model">{truck.label}</p>
              <div className="admin-truck-meter">
                <span>Odómetro registrado</span>
                <strong>
                  {formatKm(truck.odometer)} <small>km</small>
                </strong>
                <small>
                  <Clock3 size={14} />
                  Lectura del {dateLabel(truck.odometerAt)}
                </small>
              </div>
              <div className="admin-truck-driver">
                <UserRound size={18} />
                <span>
                  {assigned.length
                    ? assigned.map((driver) => driver.name).join(", ")
                    : "Sin chofer asignado"}
                </span>
              </div>
              <button
                className="button secondary"
                onClick={() => setEditing(truck)}
              >
                <Pencil size={16} />
                Editar camión
              </button>
            </article>
          );
        })}
      </div>
      {!trucks.loading && !trucks.error && !items.length && (
        <EmptyState
          title="Sumemos el primer camión"
          description="Necesitás la patente, el modelo y una lectura del odómetro."
        >
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={18} />
            Agregar camión
          </button>
        </EmptyState>
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
        <p className="admin-form-intro">
          {driver
            ? "La asignación nueva se usará en los próximos viajes."
            : "Creá su acceso y elegí el camión que usa habitualmente."}
        </p>
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

export function DriversPage({ onNotify }: PageProps) {
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const [editing, setEditing] = useState<Driver | "new" | null>(null);
  const [passwordDriver, setPasswordDriver] = useState<Driver | null>(null);
  return (
    <div className="admin-page">
      <PageHeading
        eyebrow="LAS PERSONAS"
        title="Choferes"
        description="Sus accesos y el camión que usan cada día."
        action={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={19} />
            Agregar chofer
          </button>
        }
      />
      <LoadState
        loading={drivers.loading && !drivers.data}
        error={drivers.error || trucks.error}
        retry={() => {
          drivers.reload();
          trucks.reload();
        }}
      />
      <div className="admin-drivers-list">
        {drivers.data?.items.map((driver) => (
          <article className="panel admin-driver-card" key={driver.id}>
            <div className="admin-driver-identity">
              <span className="admin-avatar">
                {driver.name
                  .split(" ")
                  .slice(0, 2)
                  .map((name) => name[0])
                  .join("")}
              </span>
              <div>
                <h2>{driver.name}</h2>
                <p>Usuario: {driver.username}</p>
              </div>
              <span
                className={`badge ${driver.active ? "success" : "neutral"}`}
              >
                {driver.active ? "Activo" : "Inactivo"}
              </span>
            </div>
            <div className="admin-driver-details">
              <span>
                <TruckIcon size={18} />
                {trucks.data?.items.find(
                  (truck) => truck.id === driver.assignedTruckId,
                )?.plate || "Sin camión asignado"}
              </span>
              {driver.phone && (
                <a href={`tel:${driver.phone}`} className="admin-phone">
                  {driver.phone}
                </a>
              )}
            </div>
            <div className="admin-driver-actions">
              <button
                className="button secondary"
                onClick={() => setEditing(driver)}
              >
                <Pencil size={16} />
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
      </div>
      {drivers.data && !drivers.data.items.length && (
        <EmptyState
          title="Agregá a tu equipo"
          description="Cada chofer tendrá su propio usuario y verá sus viajes."
        >
          <button className="button primary" onClick={() => setEditing("new")}>
            <UsersRound size={18} />
            Agregar chofer
          </button>
        </EmptyState>
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
    form.begin();
    try {
      const body = {
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
        ...(!obligation && initialRecord
          ? {
              initialRecord: {
                performedAt: businessInstant(performedAt),
                odometer: optionalNumber(odometer),
              },
            }
          : {}),
      };
      await send(
        obligation ? `/obligations/${obligation.id}` : "/obligations",
        obligation ? "PATCH" : "POST",
        body,
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={obligation ? "Editar vencimiento" : "Agregar un vencimiento"}
      wide
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <p className="admin-form-intro">
          Programá un límite por fecha, por kilómetros o por ambos.
        </p>
        <FormError message={form.message} />
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
              <Wrench size={20} />
              <span>
                <strong>Servicio</strong>
                <small>Mantenimiento del camión</small>
              </span>
              {kind === "SERVICE" && <Check size={18} />}
            </button>
            <button
              type="button"
              className={kind === "DOCUMENT" ? "selected" : ""}
              aria-pressed={kind === "DOCUMENT"}
              onClick={() => setKind("DOCUMENT")}
            >
              <FileCheck2 size={20} />
              <span>
                <strong>Documento</strong>
                <small>Seguro, patente y más</small>
              </span>
              {kind === "DOCUMENT" && <Check size={18} />}
            </button>
          </div>
        )}
        <Field
          label="Nombre del servicio o documento"
          error={form.fields.title}
        >
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
                    .filter((truck) => truck.active || truck.id === ownerId)
                    .map((truck) => (
                      <option key={truck.id} value={truck.id}>
                        {truck.plate} · {truck.label}
                      </option>
                    ))
                : drivers
                    .filter((driver) => driver.active || driver.id === ownerId)
                    .map((driver) => (
                      <option key={driver.id} value={driver.id}>
                        {driver.name}
                      </option>
                    ))}
            </select>
          </Field>
        </div>
        <div className="admin-form-block">
          <h3>
            <CalendarDays size={18} />
            Próximo vencimiento
          </h3>
          <p>
            Si indicás fecha y kilómetros, se avisará cuando se alcance el
            primero.
          </p>
          <div className="grid2">
            <Field label="Fecha límite (opcional)" error={form.fields.dueDate}>
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
                hint="Lectura total del odómetro, no kilómetros restantes."
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={dueKm}
                  onChange={(event) => setDueKm(event.target.value)}
                  placeholder="Ej. 450000"
                />
              </Field>
            )}
          </div>
          {!dueDate && (ownerType === "driver" || !dueKm) && (
            <p className="admin-inline-note">
              <Clock3 size={16} />
              Quedará pendiente de programar hasta que definas un límite.
            </p>
          )}
        </div>
        <details
          className="admin-details"
          open={!!obligation?.intervalMonths || !!obligation?.intervalKm}
        >
          <summary>
            Frecuencia y anticipación de avisos
            <ChevronDown size={18} />
          </summary>
          <div className="admin-details-content">
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
            <p className="admin-field-note">
              La frecuencia sirve para sugerir el próximo límite cuando
              registres una renovación.
            </p>
          </div>
        </details>
        {!obligation && kind === "SERVICE" && (
          <div className="admin-form-block">
            <label className="admin-check">
              <input
                type="checkbox"
                checked={initialRecord}
                onChange={(event) => setInitialRecord(event.target.checked)}
              />
              <span>
                <strong>Registrar también el último servicio</strong>
                <small>Se guardará como parte del historial del camión.</small>
              </span>
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
                      onChange={(event) => setPerformedAt(event.target.value)}
                    />
                  </Field>
                  <Field
                    label="Odómetro en ese momento"
                    error={form.fields["initialRecord.odometer"]}
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
                </div>
                {(intervalMonths || intervalKm) && (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      if (intervalMonths)
                        setDueDate(
                          addMonths(performedAt, Number(intervalMonths)),
                        );
                      if (intervalKm && odometer)
                        setDueKm(String(Number(odometer) + Number(intervalKm)));
                    }}
                  >
                    Calcular próximo límite
                  </button>
                )}
              </>
            )}
          </div>
        )}
        <Field label="Observaciones (opcional)" error={form.fields.notes}>
          <textarea
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Algún detalle que quieras recordar…"
          />
        </Field>
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
                Desactivarlo detiene los avisos y conserva el historial.
              </small>
            </span>
          </label>
        )}
        <FormFooter
          busy={form.busy}
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
    }
  }
  return (
    <Modal
      title={service ? "Registrar servicio realizado" : "Registrar renovación"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-renewal-context">
          <span className="admin-item-symbol">
            {service ? <Wrench size={22} /> : <FileCheck2 size={22} />}
          </span>
          <div>
            <strong>{obligation.title}</strong>
            <OwnerLabel obligation={obligation} />
          </div>
        </div>
        <FormError message={form.message} />
        <Field
          label={
            service
              ? "Fecha y hora del servicio"
              : "Fecha y hora de la renovación"
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
            label="Odómetro al realizar el servicio"
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
        <div className="admin-form-block">
          <h3>
            <CalendarDays size={18} />
            Confirmá el próximo vencimiento
          </h3>
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
                  min="0"
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
              ? "Revisá estos límites antes de confirmar. La renovación anterior quedará en el historial."
              : "Si dejás ambos campos vacíos, quedará pendiente de programar."}
          </p>
        </div>
        <Field label="Observaciones (opcional)" error={form.fields.notes}>
          <textarea
            rows={3}
            maxLength={2000}
            placeholder={
              service
                ? "Ej. Se cambiaron aceite y filtros."
                : "Ej. Renovación anual del seguro."
            }
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <FormFooter
          busy={form.busy}
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
  return (
    <Modal title="Historial de renovaciones" onClose={onClose}>
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
          {history.data.items.map((item) => (
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
      <div className="admin-form-footer">
        <button className="button secondary" onClick={onClose}>
          Cerrar
        </button>
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
  return (
    <div className="admin-page">
      <PageHeading
        eyebrow="ANTICIPARSE HACE LA DIFERENCIA"
        title="Servicios y vencimientos"
        description="Mantenimiento y documentación, siempre presentes."
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
            ["attention", "Necesitan atención"],
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
      <div className="admin-obligations-list">
        {filtered.map((item) => (
          <article
            key={item.id}
            className={`panel admin-obligation ${!item.active ? "is-inactive" : ""}`}
          >
            <div className="admin-obligation-main">
              <span
                className={`admin-item-symbol ${item.status.toLowerCase()}`}
              >
                {item.kind === "SERVICE" ? (
                  <Wrench size={23} />
                ) : (
                  <FileCheck2 size={23} />
                )}
              </span>
              <div className="admin-obligation-title">
                <h2>{item.title}</h2>
                <OwnerLabel obligation={item} />
              </div>
              <StatusBadge status={item.status} />
              {!item.active && <span className="badge neutral">Inactivo</span>}
            </div>
            <div className="admin-obligation-bottom">
              <div>
                <DueSummary obligation={item} />
                <p className="admin-obligation-remaining">
                  {item.status === "UNCONFIGURED"
                    ? "Definí el próximo límite para recibir avisos."
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
                </p>
              </div>
              <div className="admin-obligation-actions">
                <button
                  className="button ghost"
                  aria-label={`Historial de ${item.title}`}
                  onClick={() => setHistory(item)}
                >
                  <History size={17} />
                  <span>Historial</span>
                </button>
                <button
                  className="button secondary"
                  onClick={() => setEditing(item)}
                >
                  <Pencil size={16} />
                  <span>Editar</span>
                </button>
                {item.active && (
                  <button
                    className="button primary"
                    onClick={() => setRenewing(item)}
                  >
                    <Check size={17} />
                    {item.kind === "SERVICE" ? "Registrar servicio" : "Renovar"}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!state.loading && !state.error && !filtered.length && (
        <EmptyState
          title={
            state.data?.items.length
              ? "No hay resultados con estos filtros"
              : "Un recordatorio hoy, menos preocupaciones mañana"
          }
          description={
            state.data?.items.length
              ? "Probá con otro nombre o cambiá el filtro."
              : "Agregá el próximo servicio, seguro o documento que quieras controlar."
          }
        >
          {!state.data?.items.length && (
            <button
              className="button primary"
              onClick={() => setEditing("new")}
            >
              <Plus size={18} />
              Agregar vencimiento
            </button>
          )}
        </EmptyState>
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
  const query = new URLSearchParams({
    from,
    to,
    page: String(page),
    pageSize: "20",
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
        eyebrow="INFORMACIÓN QUE AYUDA"
        title="Resumen de viajes"
        description="Elegí un período y llevate los datos que necesitás."
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
      <section className="panel admin-report-filters">
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
        <p className="admin-field-note">
          Los totales y el Excel incluyen todos los viajes del filtro, no solo
          los que aparecen en esta página.
        </p>
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
              <span>Viajes realizados</span>
              <strong>{state.data.totals.count}</strong>
            </div>
            <div>
              <span>Kilómetros recorridos</span>
              <strong>
                {formatKm(state.data.totals.distanceKm)} <small>km</small>
              </strong>
            </div>
            <div>
              <span>Viáticos registrados</span>
              <strong>{formatMoney(state.data.totals.allowance)}</strong>
            </div>
          </div>
          <section
            className="panel admin-report-results"
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
            {state.data.total > state.data.pageSize && (
              <div className="admin-pagination">
                <span>
                  Página {page} de{" "}
                  {Math.ceil(state.data.total / state.data.pageSize)}
                </span>
                <div>
                  <button
                    className="button secondary"
                    aria-label="Página anterior"
                    disabled={page <= 1 || state.loading}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="button secondary"
                    aria-label="Página siguiente"
                    disabled={
                      page * state.data.pageSize >= state.data.total ||
                      state.loading
                    }
                    onClick={() => setPage((value) => value + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
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
    <form className="panel admin-settings-form admin-form" onSubmit={submit}>
      <div className="admin-section-head">
        <div>
          <span className="admin-settings-icon">
            <Mail size={24} />
          </span>
          <h2>Un resumen en tu correo</h2>
          <p>
            Los pendientes llegan juntos, todos los días a las 08:00, hora de
            Argentina.
          </p>
        </div>
      </div>
      <FormError message={form.message} />
      <Field
        label="Correo para recibir los avisos"
        error={form.fields.recipientEmail}
        hint="Si no hay pendientes, no se envía correo."
      >
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
        <span>
          {settings.smtpConfigured ? (
            <CheckCircle2 size={20} />
          ) : (
            <CircleAlert size={20} />
          )}
        </span>
        <div>
          <strong>
            {settings.smtpConfigured
              ? "Envío de correos configurado"
              : "El envío de correos aún no está configurado"}
          </strong>
          <p>
            {settings.smtpConfigured
              ? "Los envíos y los intentos fallidos se registran en el historial."
              : "Podés guardar el destinatario. El envío se habilitará cuando se configure la cuenta de correo del sistema."}
          </p>
        </div>
      </div>
      <div className="admin-form-block">
        <h3>
          <Bell size={18} />
          Anticipación predeterminada
        </h3>
        <p>
          Se usa al agregar nuevos vencimientos. Cada vencimiento puede tener
          sus propios valores.
        </p>
        <div className="grid2">
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
      </div>
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
  return (
    <div className="admin-page">
      <PageHeading
        eyebrow="A TU MANERA"
        title="Avisos y preferencias"
        description="Elegí dónde recibir los recordatorios de tu transporte."
      />
      <LoadState
        loading={settings.loading && !settings.data}
        error={settings.error}
        retry={settings.reload}
      />
      <div className="admin-settings-layout">
        {settings.data && (
          <SettingsForm
            key={`${settings.data.recipientEmail}-${settings.data.warningDays}-${settings.data.warningKm}`}
            settings={settings.data}
            onSaved={() => {
              settings.reload();
              onNotify("Preferencias guardadas");
            }}
          />
        )}
        <section className="panel admin-section admin-notification-panel">
          <div className="admin-section-head">
            <div>
              <p className="eyebrow">SEGUIMIENTO</p>
              <h2>Historial de correos</h2>
            </div>
            <button
              className="button ghost"
              onClick={notifications.reload}
              aria-label="Actualizar historial de correos"
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <LoadState
            loading={notifications.loading && !notifications.data}
            error={notifications.error}
            retry={notifications.reload}
          />
          {notifications.data?.items.length ? (
            <div className="admin-notification-list">
              {notifications.data.items.map((item) => (
                <article key={item.id}>
                  <div className="admin-notification-head">
                    <strong>{dateLabel(item.date)}</strong>
                    <span
                      className={`badge ${item.status === "SENT" ? "success" : item.status === "FAILED" ? "danger" : "neutral"}`}
                    >
                      {statusText(item.status)}
                    </span>
                  </div>
                  <p>{item.recipient}</p>
                  {item.error && (
                    <p className="admin-notification-error">
                      {item.status === "FAILED"
                        ? "Se agotaron los intentos de envío. Revisá la configuración del correo."
                        : item.status === "SUPERSEDED"
                          ? "Reemplazado por un resumen más reciente."
                          : item.status === "CANCELLED"
                            ? "Los vencimientos pendientes ya fueron resueltos."
                            : "El correo está pendiente. Se enviará cuando la cuenta esté disponible."}
                    </p>
                  )}
                  <small>
                    {item.sentAt
                      ? `Enviado ${formatDate(item.sentAt)}`
                      : `${item.attempts} ${item.attempts === 1 ? "intento" : "intentos"}`}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            !notifications.loading &&
            !notifications.error && (
              <EmptyState
                title="Todavía no hay envíos"
                description="Acá vas a ver cuándo se enviaron los resúmenes y si alguno necesita atención."
              />
            )
          )}
        </section>
      </div>
    </div>
  );
}

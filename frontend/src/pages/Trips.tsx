import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Clock3,
  Download,
  Eye,
  FilePenLine,
  Gauge,
  History,
  Info,
  LoaderCircle,
  MapPin,
  Plus,
  Route,
  Search,
  SlidersHorizontal,
  Truck as TruckIcon,
  X,
} from "lucide-react";
import { api, ApiError, send } from "../api";
import type { Driver, PageProps, Trip, TripList, Truck } from "../types";
import {
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  formatKm,
  formatMoney,
  Loading,
  localInput,
  Modal,
} from "../ui";
import { useData } from "../useData";

type TripFormValues = {
  truckId: string;
  driverId: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  startKm: string;
  endKm: string;
  allowance: string;
  notes: string;
};
const emptyValues = (): TripFormValues => ({
  truckId: "",
  driverId: "",
  origin: "",
  destination: "",
  departureAt: "",
  arrivalAt: "",
  startKm: "",
  endKm: "",
  allowance: "",
  notes: "",
});

export function TripForm({
  user,
  onNotify,
  onDone,
  onCancel,
  tripId,
  onDirtyChange,
}: PageProps & {
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
  onCancel: () => void;
  tripId: string | null;
}) {
  const {
    data: trucks,
    error: trucksError,
    refresh: refreshTrucks,
  } = useData<{ items: Truck[] }>("/trucks");
  const {
    data: drivers,
    error: driversError,
    refresh: refreshDrivers,
  } = useData<{ items: Driver[] }>("/drivers");
  const { data: recent } = useData<TripList>("/trips?pageSize=12");
  const [values, setValues] = useState<TripFormValues>(emptyValues),
    [fields, setFields] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(Boolean(tripId)),
    [extra, setExtra] = useState(false),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState<Trip | null>(null),
    [version, setVersion] = useState(0),
    [leave, setLeave] = useState(false),
    [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(
      null,
    ),
    [conflict, setConflict] = useState(false),
    [reloadConfirm, setReloadConfirm] = useState(false),
    [loadRevision, setLoadRevision] = useState(0);
  const baseline = useRef<TripFormValues>(emptyValues());
  const initialized = useRef(false),
    requestId = useRef(crypto.randomUUID()),
    submitting = useRef(false),
    errorRef = useRef<HTMLDivElement>(null);
  const set = (field: keyof TripFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setFields((f) => ({ ...f, [field]: "" }));
  };
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        if (!alive) return;
        const loadedValues = {
          truckId: t.truckId,
          driverId: t.driverId,
          origin: t.origin,
          destination: t.destination,
          departureAt: localInput(t.departureAt),
          arrivalAt: localInput(t.arrivalAt),
          startKm: String(t.startKm),
          endKm: String(t.endKm),
          allowance: t.allowance == null ? "" : String(t.allowance),
          notes: t.notes || "",
        };
        baseline.current = loadedValues;
        setValues(loadedValues);
        setVersion(t.version);
        setExtra(Boolean(t.notes || t.allowance != null));
        initialized.current = true;
      })
      .catch((e) => {
        if (alive) setLoadError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tripId, loadRevision]);
  useEffect(() => {
    if (tripId || initialized.current || !drivers || !trucks) return;
    const driver =
      drivers.items.find((d) => d.id === user.driverId) ||
      (user.role === "DRIVER" ? drivers.items[0] : null);
    setValues((v) => {
      const initial = {
        ...v,
        driverId: driver?.id || "",
        truckId: driver?.assignedTruckId || "",
      };
      baseline.current = initial;
      return initial;
    });
    initialized.current = true;
  }, [drivers, trucks, user, tripId]);
  const changed = JSON.stringify(values) !== JSON.stringify(baseline.current);
  const blocked = busy || Boolean(pendingBody);
  useEffect(() => {
    onDirtyChange(changed && !success);
    return () => onDirtyChange(false);
  }, [changed, success, onDirtyChange]);
  useEffect(() => {
    if (!changed || success) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [changed, success]);
  const truck = trucks?.items.find((t) => t.id === values.truckId),
    km =
      values.startKm !== "" && values.endKm !== ""
        ? Number(values.endKm) - Number(values.startKm)
        : null;
  const routes = Array.from(
    new Map(
      (recent?.items || []).map((t) => [
        `${t.origin}|${t.destination}`,
        { origin: t.origin, destination: t.destination },
      ]),
    ).values(),
  ).slice(0, 4);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const invalid: Record<string, string> = {};
    if (!values.truckId) invalid.truckId = "Elegí el camión de este viaje.";
    if (user.role === "ADMIN" && !values.driverId)
      invalid.driverId = "Elegí el chofer.";
    if (!values.origin.trim()) invalid.origin = "Ingresá desde dónde saliste.";
    if (!values.destination.trim())
      invalid.destination = "Ingresá a dónde llegaste.";
    if (!values.departureAt) invalid.departureAt = "Indicá cuándo saliste.";
    if (!values.arrivalAt) invalid.arrivalAt = "Indicá cuándo llegaste.";
    if (
      values.departureAt &&
      values.arrivalAt &&
      values.arrivalAt < values.departureAt
    )
      invalid.arrivalAt = "La llegada debe ser posterior a la salida.";
    if (!/^\d+$/.test(values.startKm))
      invalid.startKm =
        "Ingresá los kilómetros que marcaba el camión al salir.";
    if (!/^\d+$/.test(values.endKm))
      invalid.endKm = "Ingresá los kilómetros que marcaba al llegar.";
    if (km !== null && km < 0)
      invalid.endKm = "El kilometraje final debe ser igual o mayor al inicial.";
    if (
      values.allowance !== "" &&
      (!Number.isFinite(Number(values.allowance.replace(",", "."))) ||
        Number(values.allowance.replace(",", ".")) < 0)
    )
      invalid.allowance = "Ingresá un importe válido, mayor o igual a cero.";
    if (Object.keys(invalid).length) {
      setFields(invalid);
      setError("Revisá los campos señalados. Tus datos siguen acá.");
      setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }
    setFields({});
    setError("");
    setBusy(true);
    submitting.current = true;
    try {
      const body: Record<string, unknown> = pendingBody || {
        ...values,
        origin: values.origin.trim(),
        destination: values.destination.trim(),
        departureAt: new Date(`${values.departureAt}:00-03:00`).toISOString(),
        arrivalAt: new Date(`${values.arrivalAt}:00-03:00`).toISOString(),
        startKm: Number(values.startKm),
        endKm: Number(values.endKm),
        allowance:
          values.allowance === ""
            ? null
            : Number(values.allowance.replace(",", ".")),
        notes: values.notes.trim() || null,
        ...(user.role === "DRIVER" ? { driverId: undefined } : {}),
        ...(tripId ? { version } : { clientRequestId: requestId.current }),
      };
      setPendingBody(body);
      const result = await send<Trip>(
        tripId ? `/trips/${tripId}` : "/trips",
        tripId ? "PATCH" : "POST",
        body,
      );
      setPendingBody(null);
      setConflict(false);
      setSuccess(result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      const err = e as ApiError;
      if (err.status > 0 && err.status < 500) setPendingBody(null);
      setConflict(err.code === "VERSION_CONFLICT");
      setError(
        err.status === 0 || err.status >= 500
          ? "No pudimos confirmar el guardado. Reintentá el mismo envío para comprobarlo sin duplicar el viaje."
          : err.message,
      );
      setFields(err.fields || {});
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  if (loading || !trucks || !drivers) {
    const err = loadError || trucksError || driversError;
    if (err)
      return (
        <ErrorState
          message={err}
          onRetry={() => {
            refreshTrucks();
            refreshDrivers();
            onCancel();
          }}
        />
      );
    return <Loading label="Preparando la carga…" />;
  }
  if (loadError) return <ErrorState message={loadError} onRetry={onCancel} />;
  if (success)
    return (
      <section className="saved-trip">
        <div className="saved-icon">
          <CircleCheck size={46} />
        </div>
        <span className="eyebrow">TODO LISTO</span>
        <h1>
          {tripId ? "Viaje actualizado" : "Viaje guardado"}
          <span className="heading-dot">.</span>
        </h1>
        <p>
          {tripId
            ? "Los cambios ya quedaron registrados."
            : "Ya quedó en tu historial. ¡Gracias por mantener todo al día!"}
        </p>
        <div className="saved-summary panel">
          <span className="saved-route">
            <strong>{success.origin}</strong>
            <ArrowRight size={21} />
            <strong>{success.destination}</strong>
          </span>
          <div>
            <span>
              <TruckIcon size={19} />
              {success.truck.plate}
            </span>
            <span>
              <Gauge size={19} />
              {formatKm(success.distanceKm)} km
            </span>
          </div>
          <small>{formatDate(success.departureAt, true)}</small>
        </div>
        <button className="button primary" onClick={onDone}>
          Ver {user.role === "DRIVER" ? "mis viajes" : "viajes"}
          <ArrowRight size={20} />
        </button>
        <button
          className="button ghost"
          onClick={() => {
            setSuccess(null);
            requestId.current = crypto.randomUUID();
            setValues((v) => {
              const initial = {
                ...emptyValues(),
                driverId: v.driverId,
                truckId: v.truckId,
              };
              baseline.current = initial;
              return initial;
            });
            setExtra(false);
            if (tripId) onDone();
          }}
        >
          {" "}
          {tripId ? "Volver al historial" : "Cargar otro viaje"}
        </button>
      </section>
    );
  return (
    <>
      <button
        className="back-link"
        onClick={() => (changed ? setLeave(true) : onCancel())}
      >
        <ArrowLeft size={18} />
        Volver a viajes
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {tripId ? "ACTUALIZAR REGISTRO" : "UN VIAJE MÁS EN TU HISTORIAL"}
          </span>
          <h1>
            {tripId ? "Editar viaje" : "Cargar viaje"}
            <span className="heading-dot">.</span>
          </h1>
          <p>Contanos el recorrido. Los kilómetros los calculamos nosotros.</p>
        </div>
        <span className="form-context">
          <Route size={19} />
          {tripId ? "Edición" : "Nuevo registro"}
        </span>
      </div>
      <form className="trip-form-layout" onSubmit={submit} noValidate>
        <div className="trip-form-main">
          <section className="panel trip-form-section">
            <div className="form-section-title">
              <span className="step-number">01</span>
              <div>
                <h2>El recorrido</h2>
                <p>Desde dónde saliste y a dónde llegaste.</p>
              </div>
              <MapPin size={23} />
            </div>
            <div className="grid2 vehicle-fields">
              {user.role === "ADMIN" ? (
                <Field label="Chofer" error={fields.driverId}>
                  <select
                    value={values.driverId}
                    onChange={(e) => {
                      set("driverId", e.target.value);
                      const driver = drivers.items.find(
                        (d) => d.id === e.target.value,
                      );
                      if (driver?.assignedTruckId)
                        set("truckId", driver.assignedTruckId);
                    }}
                    disabled={blocked}
                  >
                    <option value="">Elegí un chofer</option>
                    {drivers.items
                      .filter((d) => d.active || d.id === values.driverId)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </Field>
              ) : (
                <div className="driver-readonly">
                  <span className="field-label">Chofer</span>
                  <span>
                    {user.name}
                    <span className="badge neutral">Vos</span>
                  </span>
                </div>
              )}
              <Field
                label="Camión"
                error={fields.truckId}
                hint="Si viajaste con otra unidad, elegila acá."
              >
                <select
                  value={values.truckId}
                  onChange={(e) => set("truckId", e.target.value)}
                  disabled={blocked}
                >
                  <option value="">Elegí un camión</option>
                  {trucks.items
                    .filter((t) => t.active || t.id === values.truckId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.plate} · {t.label}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <div className="route-inputs">
              <Field label="Salí de" error={fields.origin}>
                <span className="input-icon">
                  <span className="route-dot" />
                  <input
                    maxLength={120}
                    placeholder="Localidad de salida"
                    value={values.origin}
                    onChange={(e) => set("origin", e.target.value)}
                    disabled={blocked}
                  />
                </span>
              </Field>
              <span className="route-connector">
                <ArrowRight size={19} />
              </span>
              <Field label="Llegué a" error={fields.destination}>
                <span className="input-icon">
                  <MapPin size={19} />
                  <input
                    maxLength={120}
                    placeholder="Localidad de llegada"
                    value={values.destination}
                    onChange={(e) => set("destination", e.target.value)}
                    disabled={blocked}
                  />
                </span>
              </Field>
            </div>
            {routes.length > 0 && (
              <div className="recent-routes">
                <span>¿Repetiste un recorrido?</span>
                <div>
                  {routes.map((r, i) => (
                    <button
                      type="button"
                      key={i}
                      className="route-chip"
                      disabled={blocked}
                      onClick={() => {
                        set("origin", r.origin);
                        set("destination", r.destination);
                      }}
                    >
                      {r.origin}
                      <ArrowRight size={13} />
                      {r.destination}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="grid2 date-fields">
              <Field label="Fecha y hora de salida" error={fields.departureAt}>
                <input
                  type="datetime-local"
                  value={values.departureAt}
                  onChange={(e) => set("departureAt", e.target.value)}
                  onInput={(e) => set("departureAt", e.currentTarget.value)}
                  onBlur={(e) => set("departureAt", e.currentTarget.value)}
                  disabled={blocked}
                />
              </Field>
              <Field label="Fecha y hora de llegada" error={fields.arrivalAt}>
                <input
                  type="datetime-local"
                  value={values.arrivalAt}
                  onChange={(e) => set("arrivalAt", e.target.value)}
                  onInput={(e) => set("arrivalAt", e.currentTarget.value)}
                  onBlur={(e) => set("arrivalAt", e.currentTarget.value)}
                  disabled={blocked}
                />
              </Field>
            </div>
          </section>
          <section className="panel trip-form-section">
            <div className="form-section-title">
              <span className="step-number">02</span>
              <div>
                <h2>Los kilómetros</h2>
                <p>Lo que marcaba el odómetro del camión.</p>
              </div>
              <Gauge size={24} />
            </div>
            {truck && (
              <div className="odometer-reference">
                <Info size={18} />
                <span>
                  Última lectura registrada:{" "}
                  <strong>{formatKm(truck.odometer)} km</strong>
                  <small>
                    {formatDate(truck.odometerAt)} · Usala como referencia.
                  </small>
                </span>
              </div>
            )}
            <div className="grid2">
              <Field
                label="Al salir"
                error={fields.startKm}
                hint="Kilometraje inicial"
              >
                <span className="input-suffix">
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ej. 125000"
                    value={values.startKm}
                    onChange={(e) => set("startKm", e.target.value)}
                    disabled={blocked}
                  />
                  <span>km</span>
                </span>
              </Field>
              <Field
                label="Al llegar"
                error={fields.endKm}
                hint="Kilometraje final"
              >
                <span className="input-suffix">
                  <input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ej. 125350"
                    value={values.endKm}
                    onChange={(e) => set("endKm", e.target.value)}
                    disabled={blocked}
                  />
                  <span>km</span>
                </span>
              </Field>
            </div>
            <div
              className={`calculated-distance ${km !== null && km >= 0 ? "has-distance" : ""}`}
              aria-live="polite"
            >
              <span>
                <Route size={22} />
                Distancia del viaje
              </span>
              <strong>
                {km !== null && km >= 0 ? formatKm(km) : "—"}
                <small> km</small>
              </strong>
            </div>
          </section>
          <section className="panel optional-section">
            <button
              type="button"
              className="optional-toggle"
              onClick={() => setExtra(!extra)}
              aria-expanded={extra}
            >
              <span>
                <Plus size={20} />
                <strong>Agregar viáticos u observaciones</strong>
                <small>Opcional</small>
              </span>
              <ChevronDown className={extra ? "rotate" : ""} size={20} />
            </button>
            {extra && (
              <div className="optional-fields">
                <Field
                  label="Viáticos"
                  error={fields.allowance}
                  hint="Importe total en pesos. Si no corresponde, dejalo vacío."
                >
                  <span className="input-prefix">
                    <span>$</span>
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={values.allowance}
                      onChange={(e) => set("allowance", e.target.value)}
                      disabled={blocked}
                    />
                  </span>
                </Field>
                <Field label="Observaciones" error={fields.notes}>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    placeholder="Algo que quieras dejar anotado de este viaje…"
                    value={values.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    disabled={blocked}
                  />
                </Field>
              </div>
            )}
          </section>
          {error && (
            <div
              className="form-error"
              role="alert"
              ref={errorRef}
              tabIndex={-1}
            >
              {error}
              {conflict && (
                <div>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setReloadConfirm(true)}
                  >
                    Cargar la versión actual
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="trip-save-bar">
            <span>
              <ShieldSmall />
              Tus datos se guardan de forma segura.
            </span>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={20} />
                  Guardando…
                </>
              ) : (
                <>
                  <Check size={20} />
                  {pendingBody
                    ? "Reintentar guardado"
                    : tripId
                      ? "Guardar cambios"
                      : "Guardar viaje"}
                </>
              )}
            </button>
          </div>
        </div>
        <aside className="trip-summary panel">
          <span className="summary-icon">
            <ClipboardList size={25} />
          </span>
          <h3>Tu viaje, de un vistazo</h3>
          <p>Revisá estos datos antes de guardar.</p>
          <div className="summary-route">
            <span>
              <i />
              {values.origin || "Lugar de salida"}
            </span>
            <span className="summary-route-line" />
            <span>
              <MapPin size={17} />
              {values.destination || "Lugar de llegada"}
            </span>
          </div>
          <div className="summary-detail">
            <span>Camión</span>
            <strong>{truck?.plate || "Por elegir"}</strong>
          </div>
          <div className="summary-detail">
            <span>Distancia</span>
            <strong>
              {km !== null && km >= 0 ? `${formatKm(km)} km` : "Por completar"}
            </strong>
          </div>
          {values.allowance !== "" && (
            <div className="summary-detail">
              <span>Viáticos</span>
              <strong>{formatMoney(values.allowance.replace(",", "."))}</strong>
            </div>
          )}
          <div className="summary-tip">
            <Info size={18} />
            <span>
              Podés corregir el viaje mientras administración no lo haya
              revisado.
            </span>
          </div>
        </aside>
      </form>
      {reloadConfirm && (
        <Modal
          title="¿Cargar la versión actual?"
          onClose={() => setReloadConfirm(false)}
        >
          <div className="modal-body">
            <p>
              Se reemplazarán los cambios de este formulario por el viaje que
              está guardado ahora. Después podrás revisarlo y volver a editarlo.
            </p>
            <div className="row-actions">
              <button
                className="button secondary"
                onClick={() => setReloadConfirm(false)}
              >
                Conservar mi carga
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setReloadConfirm(false);
                  setConflict(false);
                  setError("");
                  setFields({});
                  setLoading(true);
                  setLoadRevision((v) => v + 1);
                }}
              >
                Cargar versión guardada
              </button>
            </div>
          </div>
        </Modal>
      )}
      {leave && (
        <Modal title="¿Volver al historial?" onClose={() => setLeave(false)}>
          <div className="modal-body">
            <p>
              Este viaje todavía no está guardado. Si volvés al historial, se
              perderán los datos que ingresaste.
            </p>
            <div className="row-actions">
              <button
                className="button secondary"
                onClick={() => setLeave(false)}
              >
                Seguir cargando
              </button>
              <button className="button danger" onClick={onCancel}>
                Salir sin guardar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
function ShieldSmall() {
  return <CircleCheck size={16} />;
}

export function TripsPage({
  user,
  onNotify,
  onNew,
  onEdit,
}: PageProps & { onNew: () => void; onEdit: (id: string) => void }) {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [truckId, setTruckId] = useState(""),
    [driverId, setDriverId] = useState(""),
    [reviewed, setReviewed] = useState(""),
    [page, setPage] = useState(1),
    [filters, setFilters] = useState(false),
    [detail, setDetail] = useState<Trip | null>(null),
    [cancel, setCancel] = useState<Trip | null>(null),
    [reason, setReason] = useState(""),
    [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<{ items: any[] } | null>(null),
    [showHistory, setShowHistory] = useState(false),
    [historyError, setHistoryError] = useState("");
  const query = new URLSearchParams({
    page: String(page),
    pageSize: "15",
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(truckId ? { truckId } : {}),
    ...(driverId ? { driverId } : {}),
    ...(reviewed ? { reviewed } : {}),
  });
  const { data, error, loading, refresh } = useData<TripList>(
      `/trips?${query}`,
    ),
    { data: trucks } = useData<{ items: Truck[] }>("/trucks"),
    { data: drivers } = useData<{ items: Driver[] }>("/drivers");
  const activeFilters = Boolean(from || to || truckId || driverId || reviewed);
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
    setShowHistory(true);
    setHistory(null);
    setHistoryError("");
    try {
      setHistory(await api(`/trips/${t.id}/history`));
    } catch (e) {
      setHistoryError((e as Error).message);
    }
  }
  function openDetail(t: Trip) {
    setDetail(t);
    setShowHistory(false);
    setHistory(null);
    setActionError("");
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CADA RECORRIDO, EN SU LUGAR</span>
          <h1>
            {user.role === "ADMIN" ? "Viajes" : "Mis viajes"}
            <span className="heading-dot">.</span>
          </h1>
          <p>
            {user.role === "ADMIN"
              ? "El movimiento de tu transporte, con todos los detalles."
              : "Tu historial de recorridos, siempre a mano."}
          </p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={21} />
          Cargar viaje
        </button>
      </div>
      <section className="panel trip-list-panel">
        <div className="list-toolbar">
          <div className="list-toolbar-title">
            <Route size={22} />
            <h2>Historial de viajes</h2>
            <span className="count-pill">{data?.total || 0}</span>
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
              <strong>{formatKm(data.totals.count)}</strong> viajes
            </span>
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
            <div className="trip-desktop-table table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recorrido</th>
                    <th>Salida</th>
                    <th>
                      {user.role === "ADMIN" ? "Chofer / Camión" : "Camión"}
                    </th>
                    <th>Kilómetros</th>
                    <th>Estado</th>
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <button
                          className="route-cell"
                          onClick={() => openDetail(t)}
                        >
                          <strong>{t.origin}</strong>
                          <span>
                            <ArrowRight size={14} />
                            {t.destination}
                          </span>
                        </button>
                      </td>
                      <td>
                        {formatDate(t.departureAt)}
                        <small className="cell-subtitle">
                          {new Date(t.departureAt).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "America/Argentina/Buenos_Aires",
                          })}
                        </small>
                      </td>
                      <td>
                        {user.role === "ADMIN" && (
                          <strong className="cell-title">
                            {t.driver.name}
                          </strong>
                        )}
                        <span className="plate-small">{t.truck.plate}</span>
                      </td>
                      <td>
                        <strong className="table-km">
                          {formatKm(t.distanceKm)}
                        </strong>
                        <small> km</small>
                      </td>
                      <td>
                        <TripStatus trip={t} />
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Ver viaje de ${t.origin} a ${t.destination}`}
                          onClick={() => openDetail(t)}
                        >
                          <ChevronRight size={20} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="trip-mobile-list">
              {data.items.map((t) => (
                <button
                  key={t.id}
                  className="trip-mobile-card"
                  onClick={() => openDetail(t)}
                >
                  <div className="trip-mobile-top">
                    <span>
                      <CalendarDays size={14} />
                      {formatDate(t.departureAt)}
                    </span>
                    <TripStatus trip={t} />
                  </div>
                  <div className="mobile-route">
                    <strong>{t.origin}</strong>
                    <ArrowRight size={18} />
                    <strong>{t.destination}</strong>
                  </div>
                  <div className="trip-mobile-bottom">
                    <span>
                      <TruckIcon size={17} />
                      {t.truck.plate}
                      {user.role === "ADMIN" && (
                        <small> · {t.driver.name}</small>
                      )}
                    </span>
                    <strong>
                      {formatKm(t.distanceKm)} <small>km</small>
                      <ChevronRight size={17} />
                    </strong>
                  </div>
                </button>
              ))}
            </div>
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
                : "Tu próximo viaje empieza este historial"
            }
            description={
              activeFilters
                ? "Probá otro período o limpiá los filtros."
                : "Cargá un recorrido y tené sus datos siempre a mano."
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
        <Modal title="Detalle del viaje" onClose={() => setDetail(null)} wide>
          <div className="modal-body">
            <div className="detail-route">
              <span>
                <span className="eyebrow">SALIDA</span>
                <strong>{detail.origin}</strong>
                <small>{formatDate(detail.departureAt, true)}</small>
              </span>
              <ArrowRight size={24} />
              <span>
                <span className="eyebrow">LLEGADA</span>
                <strong>{detail.destination}</strong>
                <small>{formatDate(detail.arrivalAt, true)}</small>
              </span>
            </div>
            <div className="detail-km">
              <Gauge size={25} />
              <strong>
                {formatKm(detail.distanceKm)} <small>km recorridos</small>
              </strong>
              <TripStatus trip={detail} />
            </div>
            <dl className="detail-grid">
              <div>
                <dt>Chofer</dt>
                <dd>{detail.driver.name}</dd>
              </div>
              <div>
                <dt>Camión</dt>
                <dd>
                  {detail.truck.plate} · {detail.truck.label}
                </dd>
              </div>
              <div>
                <dt>Odómetro al salir</dt>
                <dd>{formatKm(detail.startKm)} km</dd>
              </div>
              <div>
                <dt>Odómetro al llegar</dt>
                <dd>{formatKm(detail.endKm)} km</dd>
              </div>
              <div>
                <dt>Viáticos</dt>
                <dd>{formatMoney(detail.allowance)}</dd>
              </div>
              <div>
                <dt>Registrado</dt>
                <dd>{formatDate(detail.createdAt, true)}</dd>
              </div>
            </dl>
            {detail.notes && (
              <div className="detail-notes">
                <h3>Observaciones</h3>
                <p>{detail.notes}</p>
              </div>
            )}
            {actionError && (
              <div className="form-error" role="alert">
                {actionError}
              </div>
            )}
            <div className="detail-actions">
              {detail.status === "ACTIVE" &&
                (user.role === "ADMIN" || !detail.reviewedAt) && (
                  <button
                    className="button secondary"
                    onClick={() => onEdit(detail.id)}
                  >
                    <FilePenLine size={18} />
                    Editar viaje
                  </button>
                )}
              {user.role === "ADMIN" &&
                !detail.reviewedAt &&
                detail.status === "ACTIVE" && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => review(detail)}
                  >
                    <Check size={19} />
                    {busy ? "Guardando…" : "Marcar revisado"}
                  </button>
                )}
              {user.role === "ADMIN" && detail.status === "ACTIVE" && (
                <button
                  className="button ghost danger-text"
                  onClick={() => {
                    setCancel(detail);
                    setActionError("");
                  }}
                >
                  Anular viaje
                </button>
              )}
            </div>
            <button
              className="history-toggle text-button"
              onClick={() =>
                showHistory ? setShowHistory(false) : viewHistory(detail)
              }
            >
              <History size={17} />
              {showHistory ? "Ocultar historial" : "Ver historial de cambios"}
            </button>
            {showHistory && (
              <div className="audit-history">
                {historyError ? (
                  <p className="form-error">{historyError}</p>
                ) : !history ? (
                  <Loading label="Buscando cambios…" />
                ) : history.items.length ? (
                  history.items.map((event: any, i: number) => (
                    <div key={event.id || i}>
                      <span className="audit-dot" />
                      <div>
                        <strong>
                          {(
                            {
                              CREATED: "Viaje registrado",
                              UPDATED: "Viaje corregido",
                              REVIEWED: "Viaje revisado",
                              CANCELLED: "Viaje anulado",
                            } as Record<string, string>
                          )[event.action] ||
                            event.action ||
                            "Cambio registrado"}
                        </strong>
                        <small>
                          {formatDate(event.createdAt, true)}
                          {event.actor?.name ? ` · ${event.actor.name}` : ""}
                        </small>
                        {event.reason && <p>{event.reason}</p>}
                      </div>
                    </div>
                  ))
                ) : (
                  <p>Sin cambios adicionales.</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
      {cancel && (
        <Modal title="Anular viaje" onClose={() => setCancel(null)}>
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
    </>
  );
}
function TripStatus({ trip }: { trip: Trip }) {
  return (
    <span
      className={`badge ${trip.status === "CANCELLED" ? "danger" : trip.reviewedAt ? "success" : "neutral"}`}
    >
      {trip.status === "CANCELLED" ? (
        <X size={13} />
      ) : trip.reviewedAt ? (
        <CircleCheck size={13} />
      ) : (
        <Clock3 size={13} />
      )}{" "}
      {trip.status === "CANCELLED"
        ? "Anulado"
        : trip.reviewedAt
          ? "Revisado"
          : "Por revisar"}
    </span>
  );
}

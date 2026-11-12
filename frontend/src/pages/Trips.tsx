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
import type {
  Driver,
  PageProps,
  Trailer,
  Trip,
  TripList,
  Truck,
} from "../types";
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
import { useDesktopRows } from "../useDesktopRows";

type TripFormValues = {
  truckId: string;
  trailerId: string;
  driverId: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  startKm: string;
  endKm: string;
  controlCount: string;
  allowance: string;
  notes: string;
};
const emptyValues = (): TripFormValues => ({
  truckId: "",
  trailerId: "",
  driverId: "",
  origin: "",
  destination: "",
  departureAt: "",
  arrivalAt: "",
  startKm: "",
  endKm: "",
  controlCount: "0",
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
    data: trailers,
    error: trailersError,
    refresh: refreshTrailers,
  } = useData<{ items: Trailer[] }>("/trailers");
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
  const [view, setView] = useState<"trip" | "extras">("trip");
  const [trailerConfirmed, setTrailerConfirmed] = useState(false);
  const baseline = useRef<TripFormValues>(emptyValues());
  const initialized = useRef(false),
    requestId = useRef(crypto.randomUUID()),
    submitting = useRef(false),
    errorRef = useRef<HTMLDivElement>(null);
  const set = (field: keyof TripFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setFields((f) => ({ ...f, [field]: "" }));
  };
  const suggestedTrailer = (truckId: string) =>
    trailers?.items.find((t) => t.active && t.assignedTruckId === truckId)
      ?.id || "";
  const selectTruck = (truckId: string) => {
    setValues((v) => ({
      ...v,
      truckId,
      ...(!tripId ? { trailerId: suggestedTrailer(truckId) } : {}),
    }));
    if (!tripId) setTrailerConfirmed(false);
    setFields((f) => ({ ...f, truckId: "", trailerId: "" }));
  };
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    api<Trip>(`/trips/${tripId}`)
      .then((t) => {
        if (!alive) return;
        const loadedValues = {
          truckId: t.truckId,
          trailerId: t.trailerId || "",
          driverId: t.driverId,
          origin: t.origin,
          destination: t.destination,
          departureAt: localInput(t.departureAt),
          arrivalAt: localInput(t.arrivalAt),
          startKm: String(t.startKm),
          endKm: String(t.endKm),
          controlCount: t.controlCount?.toString() ?? "",
          allowance: t.allowance == null ? "" : String(t.allowance),
          notes: t.notes || "",
        };
        baseline.current = loadedValues;
        setValues(loadedValues);
        setVersion(t.version);
        setTrailerConfirmed(true);
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
    if (tripId || initialized.current || !drivers || !trucks || !trailers)
      return;
    const driver =
      drivers.items.find((d) => d.userId === user.id && d.active) ||
      (user.role === "DRIVER" ? drivers.items[0] : null);
    setValues((v) => {
      const initial = {
        ...v,
        driverId: driver?.id || "",
        truckId: driver?.assignedTruckId || "",
        trailerId:
          trailers.items.find(
            (t) => t.active && t.assignedTruckId === driver?.assignedTruckId,
          )?.id || "",
      };
      baseline.current = initial;
      return initial;
    });
    initialized.current = true;
  }, [drivers, trucks, trailers, user, tripId]);
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
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const invalid: Record<string, string> = {};
    if (!values.truckId) invalid.truckId = "Elegí el camión de este viaje.";
    if (!trailerConfirmed)
      invalid.trailerId = "Confirmá el acoplado usado o elegí Sin acoplado.";
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
    const controls = e.currentTarget.elements.namedItem(
      "controlCount",
    ) as HTMLInputElement;
    if (!controls.validity.valid)
      invalid.controlCount = controls.validity.rangeOverflow
        ? "La cantidad máxima es 2.147.483.647."
        : "Ingresá una cantidad entera, mayor o igual a 0.";
    if (
      values.allowance !== "" &&
      (!Number.isFinite(Number(values.allowance.replace(",", "."))) ||
        Number(values.allowance.replace(",", ".")) < 0)
    )
      invalid.allowance = "Ingresá un importe válido, mayor o igual a cero.";
    if (Object.keys(invalid).length) {
      const mainErrors = Object.keys(invalid).some(
        (k) => !["allowance", "notes"].includes(k),
      );
      setView(mainErrors ? "trip" : "extras");
      if (!mainErrors) setExtra(true);
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
        trailerId: values.trailerId || null,
        origin: values.origin.trim(),
        destination: values.destination.trim(),
        departureAt: new Date(`${values.departureAt}:00-03:00`).toISOString(),
        arrivalAt: new Date(`${values.arrivalAt}:00-03:00`).toISOString(),
        startKm: Number(values.startKm),
        endKm: Number(values.endKm),
        controlCount:
          values.controlCount === "" ? null : Number(values.controlCount),
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
      if (err.fields) {
        const mainErrors = Object.keys(err.fields).some(
          (k) => !["allowance", "notes"].includes(k),
        );
        setView(mainErrors ? "trip" : "extras");
        if (!mainErrors) setExtra(true);
      }
      setFields(err.fields || {});
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  if (loading || !trucks || !drivers || !trailers) {
    const err = loadError || trucksError || driversError || trailersError;
    if (err)
      return (
        <ErrorState
          message={err}
          onRetry={() => {
            refreshTrucks();
            refreshTrailers();
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
        <h1>
          {tripId ? "Viaje actualizado" : "Viaje guardado"}
          <span className="heading-dot">.</span>
        </h1>
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
            <span>{success.trailer?.plate || "Sin acoplado registrado"}</span>
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
                trailerId: suggestedTrailer(v.truckId),
              };
              baseline.current = initial;
              return initial;
            });
            setExtra(false);
            setTrailerConfirmed(false);
            if (tripId) onDone();
          }}
        >
          {" "}
          {tripId ? "Volver al historial" : "Cargar otro viaje"}
        </button>
      </section>
    );
  return (
    <div className="workspace-page trip-workspace">
      <div className="workspace-heading">
        <h1>{tripId ? "Editar viaje" : "Cargar viaje"}</h1>
        <button
          className="button ghost"
          type="button"
          onClick={() => (changed ? setLeave(true) : onCancel())}
        >
          <ArrowLeft size={18} />
          Volver
        </button>
      </div>
      <form
        className="compact-trip-form"
        data-view={view}
        onSubmit={submit}
        noValidate
      >
        <div
          className="form-tabs trip-desktop-tabs"
          aria-label="Secciones del viaje"
        >
          <button
            type="button"
            className={view === "trip" ? "active" : ""}
            onClick={() => setView("trip")}
          >
            Datos del viaje
          </button>
          <button
            type="button"
            className={view === "extras" ? "active" : ""}
            onClick={() => {
              setView("extras");
              setExtra(true);
            }}
          >
            Viáticos y observaciones<span>Opcional</span>
          </button>
        </div>
        <div className="trip-core">
          <section className="trip-route-block">
            <h2>Recorrido</h2>
            <div className="grid2">
              {user.role === "ADMIN" ? (
                <Field label="Chofer" error={fields.driverId}>
                  <select
                    value={values.driverId}
                    onChange={(e) => {
                      set("driverId", e.target.value);
                      const driver = drivers.items.find(
                        (d) => d.id === e.target.value,
                      );
                      selectTruck(driver?.assignedTruckId || "");
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
                  <span>{user.name}</span>
                </div>
              )}
              <Field label="Camión" error={fields.truckId}>
                <select
                  value={values.truckId}
                  onChange={(e) => selectTruck(e.target.value)}
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
            <Field
              label="Acoplado de este viaje"
              error={fields.trailerId}
              hint="Confirmá el usado en este viaje; puede ser distinto del asignado actualmente."
            >
              <select
                value={trailerConfirmed ? values.trailerId : "__confirm__"}
                onChange={(e) => {
                  set("trailerId", e.target.value);
                  setTrailerConfirmed(true);
                }}
                disabled={blocked || !values.truckId}
              >
                {!trailerConfirmed && (
                  <option value="__confirm__" disabled>
                    {values.trailerId
                      ? `Sugerido: ${trailers.items.find((t) => t.id === values.trailerId)?.plate || "acoplado asignado"} · confirmar`
                      : "Elegí el acoplado o Sin acoplado"}
                  </option>
                )}
                <option value="">Sin acoplado</option>
                {trailers.items
                  .filter((t) => t.active || t.id === values.trailerId)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.plate} · {t.label}
                      {!t.active ? " (inactivo)" : ""}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="grid2">
              <Field label="Salí de" error={fields.origin}>
                <input
                  maxLength={120}
                  placeholder="Localidad de salida"
                  value={values.origin}
                  onChange={(e) => set("origin", e.target.value)}
                  disabled={blocked}
                />
              </Field>
              <Field label="Llegué a" error={fields.destination}>
                <input
                  maxLength={120}
                  placeholder="Localidad de llegada"
                  value={values.destination}
                  onChange={(e) => set("destination", e.target.value)}
                  disabled={blocked}
                />
              </Field>
            </div>
            {routes.length > 0 && (
              <div className="recent-route-select">
                <Field label="Usar un recorrido reciente">
                  <select
                    value=""
                    disabled={blocked}
                    onChange={(e) => {
                      const route = routes[Number(e.target.value)];
                      if (route) {
                        set("origin", route.origin);
                        set("destination", route.destination);
                      }
                    }}
                  >
                    <option value="">Elegí un recorrido</option>
                    {routes.map((r, i) => (
                      <option key={i} value={i}>
                        {r.origin} → {r.destination}
                      </option>
                    ))}
                  </select>
                </Field>
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
          <section className="trip-km-block">
            <h2>Kilómetros y controles</h2>
            {truck && (
              <div className="odometer-reference">
                <Info size={18} />
                <span>
                  {truck.odometer === null ? (
                    <>
                      <strong>Kilometraje pendiente</strong>
                      <small>
                        Ingresá la lectura real al salir y al llegar.
                      </small>
                    </>
                  ) : (
                    <>
                      Última lectura:{" "}
                      <strong>{formatKm(truck.odometer)} km</strong>
                      <small>{formatDate(truck.odometerAt)}</small>
                    </>
                  )}
                </span>
              </div>
            )}
            <div className="grid2">
              <Field label="Odómetro al salir" error={fields.startKm}>
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
              <Field label="Odómetro al llegar" error={fields.endKm}>
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
              <span>Distancia</span>
              <strong>
                {km !== null && km >= 0 ? formatKm(km) : "—"}
                <small> km</small>
              </strong>
            </div>
            <Field label="Controles" error={fields.controlCount}>
              <input
                type="number"
                name="controlCount"
                inputMode="numeric"
                min={0}
                max={2147483647}
                step={1}
                required={!tripId || baseline.current.controlCount !== ""}
                placeholder={baseline.current.controlCount === "" ? "Sin informar" : "0"}
                value={values.controlCount}
                onChange={(e) => set("controlCount", e.target.value)}
                disabled={blocked}
              />
            </Field>
          </section>
        </div>
        <button
          type="button"
          className="optional-toggle trip-mobile-extra-toggle"
          onClick={() => setExtra(!extra)}
          aria-expanded={extra}
        >
          <span>
            <Plus size={20} />
            <strong>Viáticos y observaciones</strong>
          </span>
          <ChevronDown size={20} />
        </button>
        <section className={`trip-extra-fields ${extra ? "expanded" : ""}`}>
          <Field label="Viáticos (ARS)" error={fields.allowance}>
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
              rows={4}
              maxLength={2000}
              placeholder="Información adicional del viaje"
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              disabled={blocked}
            />
          </Field>
        </section>
        <div className="compact-trip-footer">
          {error && (
            <div
              className="form-error"
              role="alert"
              ref={errorRef}
              tabIndex={-1}
            >
              {error}
              {conflict && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setReloadConfirm(true)}
                >
                  Cargar la versión actual
                </button>
              )}
            </div>
          )}
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
    </div>
  );
}
function ShieldSmall() {
  return <CircleCheck size={16} />;
}

type TripAuditEvent = {
  id: string;
  action: string;
  createdAt: string;
  actor?: { name: string } | null;
  reason?: string | null;
  before?: {
    trailerId?: string | null;
    trailer?: { plate: string } | null;
  } | null;
  after?: {
    trailerId?: string | null;
    trailer?: { plate: string } | null;
  } | null;
};
function trailerHistoryChange(event: TripAuditEvent) {
  if (!event.after || !("trailerId" in event.after)) return "";
  const after = event.after.trailer?.plate || "Sin acoplado registrado";
  if (event.action === "CREATED") return `Acoplado: ${after}`;
  if (
    event.action === "UPDATED" &&
    (event.before?.trailerId ?? null) !== event.after.trailerId
  )
    return `Acoplado: ${event.before?.trailer?.plate || "Sin acoplado registrado"} → ${after}`;
  return "";
}
// Every character remains available: pages split at whitespace without trimming.
function paginateDetailText(
  text: string,
  maxChars = 420,
  maxBreaks = 6,
): string[] {
  if (!text) return [];
  const pages: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    let breaks = 0;
    for (let index = start; index < end; index++) {
      if (text[index] === "\n" && ++breaks === maxBreaks) {
        end = index + 1;
        break;
      }
    }
    if (end < text.length && text[end - 1] !== "\n") {
      const candidate = text.slice(start, end);
      const lastSpace = Math.max(
        candidate.lastIndexOf(" "),
        candidate.lastIndexOf("\n"),
      );
      if (lastSpace >= candidate.length * 0.65) end = start + lastSpace + 1;
      if (
        /^[\uDC00-\uDFFF]$/.test(text[end]) &&
        /^[\uD800-\uDBFF]$/.test(text[end - 1])
      )
        end--;
    }
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages;
}
function paginateTripHistory(events: TripAuditEvent[]) {
  const pages: {
    event: TripAuditEvent;
    reason: string;
    part: number;
    parts: number;
  }[][] = [];
  let short: (typeof pages)[number] = [];
  const flush = () => {
    if (short.length) {
      pages.push(short);
      short = [];
    }
  };
  for (const event of events) {
    const reason = event.reason || "";
    const long = reason.length > 110 || reason.includes("\n");
    if (long) {
      flush();
      const parts = paginateDetailText(reason);
      parts.forEach((text, index) =>
        pages.push([
          { event, reason: text, part: index + 1, parts: parts.length },
        ]),
      );
    } else {
      short.push({ event, reason, part: 1, parts: 1 });
      if (short.length === 3) flush();
    }
  }
  flush();
  return pages;
}
function TripDetailPager({
  page,
  total,
  onPage,
  label = "Página",
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (total <= 1) return null;
  return (
    <div className="trip-detail-pagination">
      <span>
        {label} {page + 1} de {total}
      </span>
      <div>
        <button
          type="button"
          className="button ghost"
          aria-label="Página anterior"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={19} />
        </button>
        <button
          type="button"
          className="button ghost"
          aria-label="Página siguiente"
          disabled={page >= total - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={19} />
        </button>
      </div>
    </div>
  );
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
  const historyPages = paginateTripHistory(history?.items || []);
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
            <div className="trip-desktop-table table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recorrido</th>
                    <th>Salida</th>
                    <th>
                      {user.role === "ADMIN" ? "Chofer / Unidades" : "Unidades"}
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
                        <small className="cell-subtitle">
                          {t.trailer
                            ? `Acoplado ${t.trailer.plate}`
                            : "Sin acoplado registrado"}
                        </small>
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
                  <small className="trip-mobile-trailer">
                    {t.trailer
                      ? `Acoplado ${t.trailer.plate}`
                      : "Sin acoplado registrado"}
                  </small>
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
                      <dd>{formatKm(detail.startKm)} km</dd>
                    </div>
                    <div>
                      <dt>Odómetro al llegar</dt>
                      <dd>{formatKm(detail.endKm)} km</dd>
                    </div>
                    <div>
                      <dt>Controles</dt>
                      <dd>{detail.controlCount ?? "Sin informar"}</dd>
                    </div>
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
                          ({ event, reason, part, parts }) => (
                            <article key={`${event.id}-${part}`}>
                              <span className="trip-detail-audit-dot" />
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
                                  {event.actor?.name
                                    ? ` · ${event.actor.name}`
                                    : ""}
                                </small>
                                {part === 1 && trailerHistoryChange(event) && (
                                  <p className="trip-detail-long-text">
                                    {trailerHistoryChange(event)}
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
              {detail.status === "ACTIVE" &&
                (user.role === "ADMIN" || !detail.reviewedAt) && (
                  <button
                    className="button secondary"
                    disabled={busy}
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
                  disabled={busy}
                  onClick={() => {
                    setCancel(detail);
                    setActionError("");
                  }}
                >
                  Anular viaje
                </button>
              )}
              {detail.status !== "ACTIVE" ||
              (user.role !== "ADMIN" && detail.reviewedAt) ? (
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

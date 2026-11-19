import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Gauge,
  Info,
  LoaderCircle,
  Plus,
  Route,
  Truck as TruckIcon,
} from "lucide-react";
import { api, ApiError, send } from "../../api";
import type {
  Driver,
  PageProps,
  Trailer,
  Trip,
  TripList,
  Truck,
} from "../../types";
import {
  ErrorState,
  Field,
  formatDate,
  formatKm,
  Loading,
  localInput,
  Modal,
} from "../../ui";
import { useData } from "../../useData";

import {
  emptyValues,
  tripToDraft,
  reuseTripAttempt,
  tripFromDraft,
  tripPreviewRequest,
  tripErrorSection,
  tripSaveFailure,
  type TripFormValues,
  type TripWriteRequest,
} from "./trip-draft";
import { useKm100Preview } from "./useKm100Preview";
import { Km100Summary } from "./TripSummary";

export function TripForm({
  user,
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
    [pendingBody, setPendingBody] = useState<TripWriteRequest | null>(null),
    [conflict, setConflict] = useState(false),
    [reloadConfirm, setReloadConfirm] = useState(false),
    [loadRevision, setLoadRevision] = useState(0);
  const [view, setView] = useState<"trip" | "extras">("trip");
  const [trailerConfirmed, setTrailerConfirmed] = useState(false);
  const [savedTrip, setSavedTrip] = useState<Trip | null>(null);
  const [kmEditing, setKmEditing] = useState(false);
  const [resolveKm100, setResolveKm100] = useState(false);
  const baseline = useRef<TripFormValues>(emptyValues());
  const initialized = useRef(false),
    requestId = useRef(crypto.randomUUID()),
    submitting = useRef(false),
    errorRef = useRef<HTMLDivElement>(null);
  const set = (field: keyof TripFormValues, value: string) => {
    const changesKmInputs = [
      "departureAt",
      "arrivalAt",
      "startKm",
      "endKm",
    ].includes(field);
    const invalidateKm =
      changesKmInputs &&
      values[field] !== value &&
      (!tripId || Boolean(savedTrip?.km100Context));
    if (invalidateKm) {
      invalidateKmPreview();
    }
    setValues((v) => ({
      ...v,
      [field]: value,
      ...(invalidateKm ? { km100: "" } : {}),
    }));
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
        const loadedValues = tripToDraft(t, localInput);
        baseline.current = loadedValues;
        setValues(loadedValues);
        setVersion(t.version);
        setSavedTrip(t);
        setKmEditing(false);
        setResolveKm100(false);
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
  const changed =
    JSON.stringify(values) !== JSON.stringify(baseline.current) || resolveKm100;
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
  const legacyKm100 = Boolean(tripId && savedTrip && !savedTrip.km100Context);
  const kmInputsChanged = (
    ["departureAt", "arrivalAt", "startKm", "endKm"] as const
  ).some((field) => values[field] !== baseline.current[field]);
  const evaluateKm =
    !tripId ||
    Boolean(
      savedTrip &&
      !legacyKm100 &&
      (kmInputsChanged || kmEditing || resolveKm100),
    );
  const kmInputKey = JSON.stringify([
    values.departureAt,
    values.arrivalAt,
    values.startKm,
    values.endKm,
  ]);
  const validKmInputs = Boolean(
    values.departureAt &&
    values.arrivalAt &&
    values.arrivalAt >= values.departureAt &&
    /^\d+$/.test(values.startKm) &&
    /^\d+$/.test(values.endKm) &&
    km !== null &&
    km >= 0 &&
    Number(values.startKm) <= 9_999_999 &&
    Number(values.endKm) <= 9_999_999,
  );
  const {
    currentPreview,
    error: kmPreviewError,
    busy: kmPreviewBusy,
    invalidate: invalidateKmPreview,
    retry: retryKmPreview,
  } = useKm100Preview({
    evaluate: evaluateKm,
    validInputs: validKmInputs,
    inputKey: kmInputKey,
    resolve: resolveKm100,
    createRequest: () =>
      tripPreviewRequest(values, baseline.current, savedTrip),
    restoreSavedValue: () => {
      if (savedTrip)
        setValues((v) =>
          v.km100 === baseline.current.km100
            ? v
            : { ...v, km100: baseline.current.km100 },
        );
    },
    onSuggestedValue: (km100) => setValues((v) => ({ ...v, km100 })),
  });
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
    if (!pendingBody && evaluateKm && validKmInputs) {
      if (!currentPreview || kmPreviewBusy || kmPreviewError) {
        invalid.km100 =
          kmPreviewError || "Esperá la comprobación de los horarios al 100%.";
      } else if (!/^\d+$/.test(values.km100) || Number(values.km100) > km!) {
        invalid.km100 = `Ingresá los km al 100%, entre 0 y ${formatKm(km!)}.`;
      } else if (resolveKm100 && currentPreview.mode === "PENDING") {
        invalid.km100 =
          "Primero confirmá los feriados de los años pendientes en Configuración.";
      }
    }
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
      const section = tripErrorSection(invalid);
      setView(section);
      if (section === "extras") setExtra(true);
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
      const body = reuseTripAttempt(pendingBody, () =>
        tripFromDraft(values, {
          baseline: baseline.current,
          savedTrip,
          role: user.role,
          evaluateKm,
          preview: currentPreview,
          resolveKm100,
          mode: tripId
            ? { kind: "update", version }
            : { kind: "create", clientRequestId: requestId.current },
        }),
      );
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
      const failure = tripSaveFailure(err);
      if (failure.clearPending) setPendingBody(null);
      setConflict(failure.conflict);
      if (failure.refreshPreview) {
        invalidateKmPreview(false);
        retryKmPreview();
        setValues((v) => ({ ...v, km100: "" }));
      }
      setError(failure.message);
      if (err.fields) {
        const section = tripErrorSection(err.fields);
        setView(section);
        if (section === "extras") setExtra(true);
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
          <Km100Summary trip={success} />
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
            setKmEditing(false);
            setResolveKm100(false);
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
            <h2>
              <Route size={18} aria-hidden="true" />
              Recorrido
            </h2>
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
            <h2>
              <Gauge size={18} aria-hidden="true" />
              Kilómetros y controles
            </h2>
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
            <section className="trip-km100" aria-label="Kilómetros al 100%">
              <div className="trip-km100-heading">
                <Clock3 size={18} aria-hidden="true" />
                <h3>Km al 100%</h3>
              </div>
              {legacyKm100 ? (
                <p className="trip-km100-help">
                  Sin informar. Este viaje se conserva tal como fue registrado.
                </p>
              ) : !evaluateKm && savedTrip ? (
                <>
                  <Km100Summary trip={savedTrip} />
                  <button
                    type="button"
                    className="text-button"
                    disabled={blocked}
                    onClick={() => setKmEditing(true)}
                  >
                    Corregir km al 100%
                  </button>
                </>
              ) : (
                <>
                  {!validKmInputs && (
                    <p className="trip-km100-help">
                      Completá las fechas, los horarios y los odómetros para
                      comprobar qué parte corresponde.
                    </p>
                  )}
                  {kmPreviewBusy && (
                    <p className="trip-km100-loading" role="status">
                      <LoaderCircle size={16} className="spin" /> Comprobando
                      horarios…
                    </p>
                  )}
                  {kmPreviewError && (
                    <div className="trip-km100-error" role="alert">
                      <p>{kmPreviewError}</p>
                      <button
                        type="button"
                        className="text-button"
                        disabled={blocked || kmPreviewBusy}
                        onClick={retryKmPreview}
                      >
                        Reintentar comprobación
                      </button>
                    </div>
                  )}
                  {currentPreview && !kmPreviewBusy && !kmPreviewError && (
                    <>
                      {currentPreview.mode === "PENDING" && (
                        <p className="trip-km100-pending">
                          <Info size={17} aria-hidden="true" />
                          <span>
                            Falta confirmar el calendario de{" "}
                            {currentPreview.missingYears.join(", ")}. Informá
                            los km al 100%; administración deberá validarlos
                            antes de revisar el viaje.
                          </span>
                        </p>
                      )}
                      {currentPreview.suggestedKm === null ? (
                        <Field
                          label="Km recorridos al 100%"
                          error={fields.km100}
                          hint="Ingresá solo los recorridos en esos horarios. Usá 0 si estuviste detenido durante todo ese tramo."
                        >
                          <span className="input-suffix">
                            <input
                              type="number"
                              name="km100"
                              inputMode="numeric"
                              min={0}
                              max={km ?? undefined}
                              step={1}
                              required
                              value={values.km100}
                              onChange={(e) => set("km100", e.target.value)}
                              disabled={blocked}
                              placeholder={`Entre 0 y ${formatKm(km ?? 0)}`}
                            />
                            <span>km</span>
                          </span>
                        </Field>
                      ) : (
                        <div className="trip-km100-automatic">
                          <strong>
                            {formatKm(currentPreview.suggestedKm)}{" "}
                            <small>km</small>
                          </strong>
                          <p>
                            {currentPreview.mode === "FULL"
                              ? "Todo el recorrido corresponde al 100%."
                              : currentPreview.mode === "PENDING"
                                ? "Sin kilómetros recorridos."
                                : "El recorrido no coincide con horarios al 100%."}
                          </p>
                          {fields.km100 && (
                            <span className="error-text" role="alert">
                              {fields.km100}
                            </span>
                          )}
                        </div>
                      )}
                      {currentPreview.intervals.length > 0 && (
                        <details className="trip-km100-intervals">
                          <summary>
                            Ver horarios al 100% dentro del viaje
                          </summary>
                          <ul>
                            {currentPreview.intervals.map((interval, index) => (
                              <li
                                key={`${interval.start}-${interval.end}-${index}`}
                              >
                                <strong>{interval.label}</strong>
                                <span>
                                  {formatDate(interval.start, true)} →{" "}
                                  {formatDate(interval.end, true)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </>
                  )}
                  {fields.km100 && !currentPreview && (
                    <p className="error-text" role="alert">
                      {fields.km100}
                    </p>
                  )}
                </>
              )}
              {savedTrip?.km100Context?.mode === "PENDING" &&
                user.role === "ADMIN" && (
                  <label className="trip-km100-resolve">
                    <input
                      type="checkbox"
                      checked={resolveKm100}
                      disabled={blocked}
                      onChange={(e) => {
                        setResolveKm100(e.target.checked);
                        setKmEditing(e.target.checked);
                        setFields((f) => ({ ...f, km100: "" }));
                        if (!e.target.checked && !kmInputsChanged)
                          setValues((v) => ({
                            ...v,
                            km100: baseline.current.km100,
                          }));
                      }}
                    />
                    <span>Validar estos km con el calendario confirmado</span>
                  </label>
                )}
              {tripId && kmEditing && !kmInputsChanged && !resolveKm100 && (
                <button
                  type="button"
                  className="text-button"
                  disabled={blocked}
                  onClick={() => {
                    setKmEditing(false);
                    setValues((v) => ({ ...v, km100: baseline.current.km100 }));
                    setFields((f) => ({ ...f, km100: "" }));
                  }}
                >
                  Conservar el valor guardado
                </button>
              )}
            </section>
            <Field label="Controles" error={fields.controlCount}>
              <input
                type="number"
                name="controlCount"
                inputMode="numeric"
                min={0}
                max={2147483647}
                step={1}
                required={!tripId || baseline.current.controlCount !== ""}
                placeholder={
                  baseline.current.controlCount === "" ? "Sin informar" : "0"
                }
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

import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  Plus,
  Truck as TruckIcon,
} from "lucide-react";
import type { Dashboard, PageProps } from "../types";
import {
  EmptyState,
  ErrorState,
  formatDate,
  formatKm,
  Loading,
  StatusBadge,
} from "../ui";
import { useData } from "../useData";
import {
  lastReadingLabel,
  maintenanceMileageLabel,
  remainingMileageLabel,
} from "../features/truck-mileage";

export function DriverHome(props: PageProps) {
  const { data, error, loading, refresh } = useData<Dashboard>("/dashboard");
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;
  const truck = data.assignedTruck;
  const pending = data.obligations.filter((o) => o.status !== "OK");
  return (
    <div className="workspace-page driver-workspace">
      <div className="workspace-heading">
        <h1>Hola, {props.user.name.split(" ")[0]}</h1>
        <button
          className="button primary"
          onClick={() => props.onNavigate("new-trip")}
        >
          <Plus size={20} />
          Cargar viaje
        </button>
      </div>
      <section className="vehicle-strip" aria-label="Camión habitual">
        <span className="vehicle-symbol">
          <TruckIcon size={30} />
        </span>
        {truck ? (
          <>
            <div className="vehicle-identity">
              <strong>{truck.plate}</strong>
              <span>{truck.label}</span>
            </div>
            <div className="vehicle-reading">
              <strong>{maintenanceMileageLabel(truck)}</strong>
              {truck.odometerAt && <span>{lastReadingLabel(truck)}</span>}
            </div>
          </>
        ) : (
          <div className="vehicle-empty">
            <strong>Sin camión asignado</strong>
            <span>Pedí a administración que asigne tu unidad habitual.</span>
          </div>
        )}
      </section>
      <div className="month-summary" aria-label="Resumen del mes">
        <span>Este mes</span>
        <strong>
          <span className="month-value">
            {formatKm(data.stats.tripsThisMonth)}
          </span>{" "}
          <span className="month-unit">
            {data.stats.tripsThisMonth === 1 ? "viaje" : "viajes"}
          </span>
        </strong>
        <strong>
          <span className="month-value">
            {formatKm(data.stats.kilometersThisMonth)}
          </span>{" "}
          <span className="month-unit">km</span>
        </strong>
      </div>
      <div className="driver-ledger">
        <section className="driver-recent">
          <div className="section-heading">
            <h2>Últimos viajes</h2>
            <button
              className="text-button"
              onClick={() => props.onNavigate("trips")}
            >
              Ver todos
              <ArrowUpRight size={17} />
            </button>
          </div>
          {data.recentTrips.length ? (
            <div className="recent-trip-list">
              {data.recentTrips.slice(0, 3).map((t) => (
                <button
                  className="recent-trip"
                  key={t.id}
                  onClick={() => props.onNavigate("trips")}
                >
                  <span className="recent-trip-main">
                    <strong>
                      {t.origin}
                      <ArrowRight size={15} />
                      {t.destination}
                    </strong>
                    <small>
                      {formatDate(t.departureAt)} · {t.truck.plate}
                      {t.trailer ? ` · Acoplado ${t.trailer.plate}` : ""}
                    </small>
                  </span>
                  <span className="recent-trip-km">
                    <strong>{formatKm(t.distanceKm)}</strong>
                    <small>km</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Todavía no cargaste viajes"
              description="Usá Cargar viaje para registrar el primero."
            />
          )}
        </section>
        <section className="driver-controls">
          <div className="section-heading">
            <h2>Próximos controles</h2>
          </div>
          {pending.length ? (
            pending.slice(0, 2).map((o) => (
              <div className="control-line" key={o.id}>
                <StatusBadge status={o.status} />
                <strong>{o.title}</strong>
                {o.trailer && <small>Acoplado · {o.trailer.plate}</small>}
                {o.odometerMissing && <small>Falta informar kilometraje</small>}
                {o.kmRemaining != null && o.truck?.mileageEstimated && (
                  <small>{remainingMileageLabel(o.kmRemaining, true)}</small>
                )}
                <span>
                  {o.dueDate
                    ? formatDate(o.dueDate)
                    : o.dueKm
                      ? `${formatKm(o.dueKm)} km`
                      : "Pendiente de configurar"}
                </span>
              </div>
            ))
          ) : (
            <p className="inline-clear">
              <CircleCheck size={20} />
              Sin vencimientos cercanos
            </p>
          )}
          {pending.length > 2 && (
            <p className="muted">
              Administración gestiona otros {pending.length - 2} controles
              pendientes.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

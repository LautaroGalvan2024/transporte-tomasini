import { useState } from "react";
import {
  ArrowRight,
  ChevronRight,
  FileCheck2,
  Plus,
  Route,
  ShieldCheck,
  Truck as TruckIcon,
  Wrench,
} from "lucide-react";
import type { Dashboard, PageProps } from "../../types";
import { EmptyState, StatusBadge, formatKm } from "../../ui";
import { dateLabel } from "./formatting";
import {
  useLoad,
  PageHeading,
  usePageSize,
  Pagination,
  usePagination,
  LoadState,
  OwnerLabel,
  DueSummary,
} from "./shared";

export function AdminDashboard({ onNavigate }: PageProps) {
  const state = useLoad<Dashboard>("/dashboard");
  const [tab, setTab] = useState("trips");
  const pageSize = usePageSize(440, 84);
  const pending =
    state.data?.obligations.filter(
      (item) => item.active && item.ownerActive && item.status !== "OK",
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
                  ["trips", "Últimos viajes"],
                  ["attention", "Vencimientos"],
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
                    <strong>
                      {truck.odometer === null
                        ? "Sin informar"
                        : `${formatKm(truck.odometer)} km`}
                    </strong>
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

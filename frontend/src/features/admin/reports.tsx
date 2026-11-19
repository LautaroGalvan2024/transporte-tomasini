import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowRight } from "lucide-react";
import type { Driver, PageProps, TripList, Truck } from "../../types";
import { EmptyState, Field, Modal, formatKm, formatMoney } from "../../ui";
import { dateToday, dateLabel, err } from "./formatting";
import {
  useLoad,
  PageHeading,
  usePageSize,
  Pagination,
  LoadState,
  FormError,
} from "./shared";

export function ReportsPage({ onNotify }: PageProps) {
  const today = dateToday();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [page, setPage] = useState(1);
  const [monthlyOpen, setMonthlyOpen] = useState(false);
  const [monthlyDriverId, setMonthlyDriverId] = useState("");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [monthlyError, setMonthlyError] = useState("");
  const [exporting, setExporting] = useState<"monthly" | "detail" | null>(null);
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
  const monthlyDriver = drivers.data?.items.find(
    (driver) => driver.id === monthlyDriverId,
  );
  const monthlyReady = !!monthlyDriver && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  async function download(format: "monthly" | "detail") {
    if (exporting) return;
    if (format === "monthly" && !monthlyReady) return;
    setExporting(format);
    setMonthlyError("");
    try {
      const filters =
        format === "monthly"
          ? new URLSearchParams({ driverId: monthlyDriverId, month })
          : new URLSearchParams(query);
      filters.set("format", format);
      const response = await fetch(`/api/trips/export?${filters}`, {
        credentials: "same-origin",
        headers: { "X-Tomasini-Request": "1" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        if (format === "monthly" && response.status === 404) {
          throw new Error(
            body?.error?.message ||
              "No hay viajes de este chofer en el mes seleccionado.",
          );
        }
        throw new Error(
          body?.error?.message || "No pudimos generar el archivo.",
        );
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      if (format === "monthly" && monthlyDriver) {
        const name =
          monthlyDriver.name
            .normalize("NFC")
            .replace(/[^\p{L}\p{N}]+/gu, "-")
            .replace(/^-|-$/g, "") || "chofer";
        link.download = `Tomasini-${name}-${month}.xlsx`;
      } else {
        link.download = `Tomasini-detalle-${from}-${to}.xlsx`;
      }
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      if (format === "monthly") setMonthlyOpen(false);
      onNotify("El archivo de Excel está listo para descargar.");
    } catch (error) {
      if (format === "monthly") setMonthlyError(err(error));
      else onNotify(err(error), "error");
    } finally {
      setExporting(null);
    }
  }
  const invalidDates = !from || !to || from > to;
  const detailDisabled =
    invalidDates ||
    !state.data?.total ||
    !!state.error ||
    state.loading ||
    exporting !== null;
  return (
    <div className="admin-page">
      <PageHeading
        title="Reportes"
        action={
          <div className="admin-heading-actions report-downloads">
            <button
              className="button primary"
              disabled={exporting !== null}
              aria-haspopup="dialog"
              onClick={() => {
                setMonthlyError("");
                setMonthlyOpen(true);
              }}
            >
              <ArrowDownToLine size={19} />
              Planilla para el contador
            </button>
            <button
              className="button secondary"
              disabled={detailDisabled}
              onClick={() => download("detail")}
            >
              <ArrowDownToLine size={17} />
              {exporting === "detail"
                ? "Preparando detalle…"
                : "Detalle operativo"}
            </button>
          </div>
        }
      />
      {monthlyOpen && (
        <Modal
          title="Planilla para el contador"
          dismissible={exporting !== "monthly"}
          onClose={() => {
            if (exporting !== "monthly") setMonthlyOpen(false);
          }}
        >
          <form
            className="admin-form"
            aria-busy={exporting === "monthly"}
            onSubmit={(event) => {
              event.preventDefault();
              void download("monthly");
            }}
          >
            <p className="admin-form-intro">
              Descargá en un solo Excel todos los viajes del chofer con salida
              en el mes elegido.
            </p>
            <LoadState
              loading={drivers.loading}
              error={drivers.error}
              retry={drivers.reload}
            />
            {!drivers.loading &&
              !drivers.error &&
              (drivers.data?.items.length ? (
                <>
                  <Field label="Chofer">
                    <select
                      required
                      disabled={exporting === "monthly"}
                      value={monthlyDriverId}
                      onChange={(event) => {
                        setMonthlyDriverId(event.target.value);
                        setMonthlyError("");
                      }}
                    >
                      <option value="">Seleccioná un chofer</option>
                      {drivers.data.items.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.name}
                          {!driver.active ? " (inactivo)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Mes de salida">
                    <input
                      type="month"
                      required
                      placeholder="AAAA-MM"
                      disabled={exporting === "monthly"}
                      value={month}
                      onChange={(event) => {
                        setMonth(event.target.value);
                        setMonthlyError("");
                      }}
                    />
                  </Field>
                  <FormError message={monthlyError} />
                  <div className="admin-form-footer">
                    <button
                      className="button primary"
                      disabled={!monthlyReady || exporting !== null}
                    >
                      <ArrowDownToLine size={18} />
                      {exporting === "monthly"
                        ? "Preparando planilla…"
                        : "Descargar planilla"}
                    </button>
                  </div>
                </>
              ) : (
                <p role="status">Todavía no hay choferes registrados.</p>
              ))}
          </form>
        </Modal>
      )}
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
                            <small>
                              {trip.trailer
                                ? `Acoplado · ${trip.trailer.plate}`
                                : "Sin acoplado registrado"}
                            </small>
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
                      <p>
                        {trip.trailer
                          ? `Acoplado · ${trip.trailer.plate}`
                          : "Sin acoplado registrado"}
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

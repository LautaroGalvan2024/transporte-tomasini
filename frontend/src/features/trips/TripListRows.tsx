import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Truck as TruckIcon,
} from "lucide-react";
import type { Role, Trip } from "../../types";
import { formatDate, formatKm } from "../../ui";
import { TripStatus } from "./TripSummary";
import { tripRowPresentation } from "./trip-presentation";

export function TripListRows({
  items,
  role,
  onOpen,
}: {
  items: Trip[];
  role: Role;
  onOpen: (trip: Trip) => void;
}) {
  const rows = items.map((trip) =>
    tripRowPresentation(trip, { date: formatDate, kilometers: formatKm }),
  );
  return (
    <>
      <div className="trip-desktop-table table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Recorrido</th>
              <th>Salida</th>
              <th>{role === "ADMIN" ? "Chofer / Unidades" : "Unidades"}</th>
              <th>Kilómetros</th>
              <th>Estado</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TripTableRow
                key={row.trip.id}
                row={row}
                role={role}
                onOpen={onOpen}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="trip-mobile-list">
        {rows.map((row) => (
          <TripCard key={row.trip.id} row={row} role={role} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

type TripRowProps = {
  row: ReturnType<typeof tripRowPresentation>;
  role: Role;
  onOpen: (trip: Trip) => void;
};

function TripTableRow({ row, role, onOpen }: TripRowProps) {
  const { trip: t } = row;
  return (
    <tr>
      <td>
        <button className="route-cell" onClick={() => onOpen(t)}>
          <strong>{t.origin}</strong>
          <span>
            <ArrowRight size={14} />
            {t.destination}
          </span>
        </button>
      </td>
      <td>
        {row.date}
        <small className="cell-subtitle">{row.time}</small>
      </td>
      <td>
        {role === "ADMIN" && (
          <strong className="cell-title">{row.driverName}</strong>
        )}
        <span className="plate-small">{row.truckPlate}</span>
        <small className="cell-subtitle">{row.trailerLabel}</small>
      </td>
      <td>
        <strong className="table-km">{row.distanceKm}</strong>
        <small> km</small>
        {t.km100 != null && (
          <small className="cell-subtitle">
            {row.km100} al 100%
            {row.km100DesktopSuffix}
          </small>
        )}
      </td>
      <td>
        <TripStatus trip={t} presentation={row.status} />
      </td>
      <td>
        <button
          className="icon-button"
          aria-label={`Ver viaje de ${t.origin} a ${t.destination}`}
          onClick={() => onOpen(t)}
        >
          <ChevronRight size={20} />
        </button>
      </td>
    </tr>
  );
}

function TripCard({ row, role, onOpen }: TripRowProps) {
  const { trip: t } = row;
  return (
    <button className="trip-mobile-card" onClick={() => onOpen(t)}>
      <div className="trip-mobile-top">
        <span>
          <CalendarDays size={14} />
          {row.date}
        </span>
        <TripStatus trip={t} presentation={row.status} />
      </div>
      <div className="mobile-route">
        <strong>{t.origin}</strong>
        <ArrowRight size={18} />
        <strong>{t.destination}</strong>
      </div>
      <div className="trip-mobile-bottom">
        <span>
          <TruckIcon size={17} />
          {row.truckPlate}
          {role === "ADMIN" && <small> · {row.driverName}</small>}
        </span>
        <strong>
          {row.distanceKm} <small>km</small>
          <ChevronRight size={17} />
        </strong>
      </div>
      <small className="trip-mobile-trailer">{row.trailerLabel}</small>
      {t.km100 != null && (
        <small className="trip-mobile-km100">
          {row.km100} km al 100%
          {row.km100MobileSuffix}
        </small>
      )}
    </button>
  );
}

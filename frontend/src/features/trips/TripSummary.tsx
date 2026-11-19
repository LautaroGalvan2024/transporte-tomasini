import type { Trip } from "../../types";
import { formatKm } from "../../ui";
import { X, CircleCheck, Clock3 } from "lucide-react";
import {
  tripStatusPresentation,
  type TripStatusPresentation,
} from "./trip-presentation";

export function Km100Summary({
  trip,
}: {
  trip: Pick<Trip, "km100" | "km100Context">;
}) {
  return (
    <div
      className={`trip-km100-summary ${trip.km100Context?.mode === "PENDING" ? "pending" : ""}`}
    >
      <span>Km al 100%</span>
      <strong>
        {trip.km100 == null ? "Sin informar" : `${formatKm(trip.km100)} km`}
      </strong>
      {trip.km100Context?.mode === "PENDING" && (
        <small>
          Pendiente de validar el calendario. Aún no se incluye en la planilla
          del contador.
        </small>
      )}
    </div>
  );
}
export function TripStatus({
  trip,
  presentation,
}: {
  trip: Trip;
  presentation?: TripStatusPresentation;
}) {
  const status = presentation ?? tripStatusPresentation(trip);
  return (
    <span className={`badge ${status.tone}`}>
      {status.icon === "cancelled" ? (
        <X size={13} />
      ) : status.icon === "reviewed" ? (
        <CircleCheck size={13} />
      ) : (
        <Clock3 size={13} />
      )}{" "}
      {status.label}
    </span>
  );
}

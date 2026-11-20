import type { Truck } from "../types";
import { formatDate, formatKm } from "../ui";

export function maintenanceMileageLabel(truck: Truck) {
  if (truck.mileageEstimated && truck.maintenanceKm != null)
    return `${formatKm(truck.maintenanceKm)} km estimados`;
  return truck.odometer == null
    ? "Sin informar"
    : `${formatKm(truck.odometer)} km`;
}

export function lastReadingLabel(truck: Truck) {
  if (truck.odometer == null || !truck.odometerAt) return "";
  const reading = truck.mileageEstimated
    ? ` · ${formatKm(truck.odometer)} km`
    : "";
  return `Última lectura real${reading} · ${formatDate(truck.odometerAt)}`;
}

export function remainingMileageLabel(remaining: number, estimated: boolean) {
  let balance = "Límite alcanzado";
  if (remaining > 0) balance = `Faltan ${formatKm(remaining)} km`;
  if (remaining < 0) balance = `${formatKm(-remaining)} km sobre el límite`;
  return estimated ? `${balance} · Según kilometraje estimado` : balance;
}

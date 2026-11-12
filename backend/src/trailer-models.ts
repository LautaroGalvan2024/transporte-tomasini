import type { AuthUser } from "./auth.js";
import { getDb, type Tx } from "./db.js";
import { ensure } from "./errors.js";
export { lockTrailers } from "./db.js";

// Call under lockAccessChanges so Truck/Trailer plate checks form one registry.
export async function availableFleetPlate(
  tx: Tx,
  plate: string,
  excludedId?: string,
) {
  const [truck, trailer] = await Promise.all([
    tx.truck.findFirst({
      where: { plate, ...(excludedId ? { id: { not: excludedId } } : {}) },
      select: { id: true },
    }),
    tx.trailer.findFirst({
      where: { plate, ...(excludedId ? { id: { not: excludedId } } : {}) },
      select: { id: true },
    }),
  ]);
  ensure(
    !truck && !trailer,
    409,
    "Esta patente ya pertenece a un camión o acoplado.",
    "DUPLICATE",
  );
}

export async function activeTrailer(tx: Tx, id: string) {
  const trailer = await tx.trailer.findUnique({ where: { id } });
  ensure(trailer?.active, 400, "Seleccioná un acoplado activo.");
  return trailer;
}

export async function validateTrailerOverlap(
  tx: Tx,
  trailerId: string,
  departureAt: Date,
  arrivalAt: Date,
  excludedId?: string,
) {
  const conflict = await tx.trip.findFirst({
    where: {
      trailerId,
      status: "ACTIVE",
      departureAt: { lt: arrivalAt },
      arrivalAt: { gt: departureAt },
      ...(excludedId ? { id: { not: excludedId } } : {}),
    },
  });
  ensure(
    !conflict,
    409,
    "El acoplado ya tiene un viaje en ese horario.",
    "OVERLAPPING_TRAILER_TRIP",
  );
}

export async function trailerDtos(
  db: Tx = getDb(),
  trailerId?: string,
  user?: AuthUser,
) {
  const rows = await db.trailer.findMany({
    where: {
      ...(trailerId ? { id: trailerId } : {}),
      ...(user?.role === "DRIVER"
        ? {
            OR: [
              { active: true },
              {
                trips: {
                  some: {
                    driverId:
                      user.driver?.id ?? "00000000-0000-0000-0000-000000000000",
                  },
                },
              },
            ],
          }
        : {}),
    },
    include: {
      assignedTruck: {
        select: { id: true, plate: true, label: true, active: true },
      },
    },
    orderBy: { plate: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    plate: row.plate,
    label: row.label,
    active: row.active,
    assignedTruckId: row.assignedTruckId,
    truck: row.assignedTruck,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

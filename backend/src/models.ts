import { Prisma, type Trip, type Truck } from "@prisma/client";
import { getDb, type Tx } from "./db.js";
import type { AuthUser } from "./auth.js";
import { calculateStatus, dateOnly, type Reading } from "./domain.js";
import { ensure } from "./errors.js";
import { trailerDtos } from "./trailer-models.js";
import { parseKm100Context } from "./holiday-domain.js";
import { tripDistance } from "./trip-mileage.js";
export { activeTrailer, validateTrailerOverlap } from "./trailer-models.js";
import {
  adjustmentReading,
  odometerAdjustments,
  ODOMETER_ADJUSTED,
  validateAdjustedHistory,
  validateOperationalHistory,
} from "./odometer.js";

export const tripInclude = {
  driver: { include: { user: true } },
  truck: true,
  trailer: true,
} satisfies Prisma.TripInclude;
type TripRow = Prisma.TripGetPayload<{ include: typeof tripInclude }>;
export function tripDto(row: TripRow) {
  return {
    id: row.id,
    driverId: row.driverId,
    createdById: row.createdById,
    truckId: row.truckId,
    trailerId: row.trailerId,
    origin: row.origin,
    destination: row.destination,
    departureAt: row.departureAt.toISOString(),
    arrivalAt: row.arrivalAt.toISOString(),
    startKm: row.startKm,
    endKm: row.endKm,
    mileageMode: row.manualDistanceKm === null ? "ODOMETER" : "DISTANCE",
    distanceSource: row.distanceSource,
    distanceKm: tripDistance(row),
    controlCount: row.controlCount,
    km100: row.km100,
    km100Context: parseKm100Context(row.km100Context),
    allowance: row.allowance?.toFixed(2) ?? null,
    notes: row.notes,
    status: row.status,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version,
    driver: { id: row.driver.id, name: row.driver.user.name },
    truck: { id: row.truck.id, plate: row.truck.plate, label: row.truck.label },
    trailer: row.trailer
      ? {
          id: row.trailer.id,
          plate: row.trailer.plate,
          label: row.trailer.label,
        }
      : null,
  };
}

export function truckDtos(db: Tx = getDb(), truckId?: string) {
  return readSnapshot(db, (tx) => readTrucks(tx, truckId));
}

// An existing transaction already provides a snapshot. Standalone read models
// need one as well, so a service and its updated due km agree with the fleet.
export function readSnapshot<T>(db: Tx, read: (tx: Tx) => Promise<T>) {
  return db === getDb()
    ? getDb().$transaction(read, {
        isolationLevel: "RepeatableRead",
        maxWait: 5_000,
        timeout: 15_000,
      })
    : read(db);
}

async function readTrucks(db: Tx, truckId?: string) {
  const rows = await db.truck.findMany({
    where: truckId ? { id: truckId } : undefined,
    orderBy: { plate: "asc" },
    include: {
      trips: {
        where: { status: "ACTIVE", endKm: { not: null } },
        orderBy: { arrivalAt: "desc" },
        take: 1,
      },
      obligations: {
        include: {
          renewals: {
            where: { odometer: { not: null } },
            orderBy: { performedAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  const adjustments = await db.audit.findMany({
    where: {
      entity: "TRUCK",
      action: ODOMETER_ADJUSTED,
      entityId: { in: rows.map((row) => row.id) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, after: true },
  });
  const latestAdjustment = new Map<
    string,
    ReturnType<typeof adjustmentReading>
  >();
  for (const row of adjustments)
    if (!latestAdjustment.has(row.entityId))
      latestAdjustment.set(row.entityId, adjustmentReading(row.after));
  const trucks = rows.map((row) => {
    const readings = [
      ...(row.initialOdometer !== null && row.initialOdometerAt !== null
        ? [{ at: row.initialOdometerAt, km: row.initialOdometer }]
        : []),
      ...row.trips.map((t) => ({ at: t.arrivalAt, km: t.endKm! })),
      ...row.obligations.flatMap((o) =>
        o.renewals.map((r) => ({ at: r.performedAt, km: r.odometer! })),
      ),
      ...(latestAdjustment.has(row.id) ? [latestAdjustment.get(row.id)!] : []),
    ];
    readings.sort((a, b) => b.at.getTime() - a.at.getTime() || b.km - a.km);
    return {
      id: row.id,
      plate: row.plate,
      label: row.label,
      active: row.active,
      initialOdometer: row.initialOdometer,
      initialOdometerAt: row.initialOdometerAt?.toISOString() ?? null,
      odometer: readings[0]?.km ?? null,
      odometerAt: readings[0]?.at.toISOString() ?? null,
    };
  });
  const anchors = trucks.flatMap((truck) =>
    truck.odometerAt === null
      ? []
      : [
          {
            truckId: truck.id,
            departureAt: { gte: truck.odometerAt },
            arrivalAt: { gt: truck.odometerAt },
          },
        ],
  );
  // At departure the entire distance is still pending. At arrival the real
  // reading already includes it, even for a trip with identical timestamps.
  const totals = anchors.length
    ? await db.trip.groupBy({
        by: ["truckId"],
        where: { status: "ACTIVE", distanceSource: { not: null }, OR: anchors },
        _sum: { manualDistanceKm: true },
        _max: { arrivalAt: true },
      })
    : [];
  const totalsByTruck = new Map(totals.map((total) => [total.truckId, total]));
  return trucks.map((truck) => {
    const total = totalsByTruck.get(truck.id);
    return {
      ...truck,
      maintenanceKm:
        truck.odometer === null
          ? null
          : truck.odometer + (total?._sum.manualDistanceKm ?? 0),
      maintenanceKmAt: total?._max.arrivalAt?.toISOString() ?? truck.odometerAt,
      mileageEstimated: total !== undefined,
    };
  });
}

type Fleet = Awaited<ReturnType<typeof readTrucks>>;

export function driverDtos(user: AuthUser, db: Tx = getDb(), fleet?: Fleet) {
  return readSnapshot(db, (tx) => readDrivers(user, tx, fleet));
}

async function readDrivers(user: AuthUser, db: Tx, fleet?: Fleet) {
  const rows = await db.driver.findMany({
    where: user.role === "DRIVER" ? { userId: user.id } : {},
    include: { user: true },
    orderBy: { user: { name: "asc" } },
  });
  const trucks = fleet ?? (await readTrucks(db));
  const truckMap = new Map(trucks.map((t) => [t.id, t]));
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    name: row.user.name,
    username: row.user.username,
    phone: row.phone,
    cuil: row.cuil,
    role: row.user.role,
    accountActive: row.user.active,
    active: row.user.active,
    assignedTruckId: row.assignedTruckId,
    truck: row.assignedTruckId
      ? (truckMap.get(row.assignedTruckId) ?? null)
      : null,
  }));
}

export function obligationDtos(
  user?: AuthUser,
  db: Tx = getDb(),
  now = new Date(),
  fleet?: Fleet,
) {
  return readSnapshot(db, (tx) => readObligations(user, tx, now, fleet));
}

async function readObligations(
  user: AuthUser | undefined,
  db: Tx,
  now: Date,
  fleet?: Fleet,
) {
  const where: Prisma.ObligationWhereInput =
    user?.role === "DRIVER"
      ? {
          OR: [
            {
              driverId:
                user.driver?.id ?? "00000000-0000-0000-0000-000000000000",
            },
            ...(user.driver?.assignedTruckId
              ? [
                  { truckId: user.driver.assignedTruckId },
                  {
                    trailer: {
                      active: true,
                      assignedTruckId: user.driver.assignedTruckId,
                    },
                  },
                ]
              : []),
          ],
          active: true,
        }
      : {};
  const rows = await db.obligation.findMany({
    where,
    include: {
      driver: { include: { user: true } },
      renewals: { orderBy: { performedAt: "desc" }, take: 1 },
    },
    orderBy: { title: "asc" },
  });
  const trucks = fleet ?? (await readTrucks(db));
  const trailers = await trailerDtos(db);
  const truckMap = new Map(trucks.map((t) => [t.id, t]));
  const trailerMap = new Map(trailers.map((t) => [t.id, t]));
  return rows.map((row) => {
    const truck = row.truckId ? (truckMap.get(row.truckId) ?? null) : null;
    const trailer = row.trailerId
      ? (trailerMap.get(row.trailerId) ?? null)
      : null;
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      truckId: row.truckId,
      driverId: row.driverId,
      trailerId: row.trailerId,
      dueDate: dateOnly(row.dueDate),
      dueKm: row.dueKm,
      intervalMonths: row.intervalMonths,
      intervalKm: row.intervalKm,
      warningDays: row.warningDays,
      warningKm: row.warningKm,
      notes: row.notes,
      active: row.active,
      ownerActive: row.truckId
        ? truck?.active === true
        : row.trailerId
          ? trailer?.active === true
          : row.driver?.user.active === true,
      version: row.version,
      ...calculateStatus(row, truck?.maintenanceKm ?? null, now),
      truck,
      trailer,
      driver: row.driver
        ? { id: row.driver.id, name: row.driver.user.name }
        : null,
      lastPerformedAt: row.renewals[0]?.performedAt.toISOString() ?? null,
      lastOdometer: row.renewals[0]?.odometer ?? null,
    };
  });
}

export async function validateTruckHistory(
  tx: Tx,
  truckId: string,
  candidate?: Pick<
    Trip,
    "id" | "departureAt" | "arrivalAt" | "startKm" | "endKm" | "distanceSource"
  >,
  excludedTripId?: string,
  extraReading?: Reading,
) {
  const truck = await tx.truck.findUnique({ where: { id: truckId } });
  ensure(truck, 404, "No se encontró el camión.");
  const [trips, renewals] = await Promise.all([
    tx.trip.findMany({
      where: {
        truckId,
        status: "ACTIVE",
        ...(excludedTripId ? { id: { not: excludedTripId } } : {}),
      },
    }),
    tx.renewal.findMany({
      where: { obligation: { truckId }, odometer: { not: null } },
      include: { obligation: { select: { title: true } } },
    }),
  ]);
  if (candidate) {
    const overlap = trips.find(
      (t) =>
        candidate.departureAt < t.arrivalAt &&
        candidate.arrivalAt > t.departureAt,
    );
    ensure(
      !overlap,
      409,
      "El camión ya tiene un viaje en ese horario.",
      "OVERLAPPING_TRIP",
    );
  }
  const history = [...trips, ...(candidate ? [candidate] : [])];
  const measuredTrips = history.filter(
    (t) => t.startKm !== null && t.endKm !== null,
  );
  const readings: Reading[] = [
    ...(truck.initialOdometer !== null && truck.initialOdometerAt !== null
      ? [
          {
            at: truck.initialOdometerAt,
            km: truck.initialOdometer,
            label: "lectura inicial",
          },
        ]
      : []),
    ...measuredTrips.flatMap((t) => [
      { at: t.departureAt, km: t.startKm!, label: "salida de un viaje" },
      { at: t.arrivalAt, km: t.endKm!, label: "llegada de un viaje" },
    ]),
    ...renewals.map((r) => ({
      at: r.performedAt,
      km: r.odometer!,
      label: r.obligation.title,
    })),
    ...(extraReading ? [extraReading] : []),
  ];
  const adjustments = await odometerAdjustments(tx, truckId);
  validateOperationalHistory(
    history.filter((t) => t.distanceSource !== null),
    [...readings, ...adjustments],
  );
  validateAdjustedHistory(readings, adjustments, measuredTrips);
  return truck;
}

export async function validateDriverOverlap(
  tx: Tx,
  driverId: string,
  departureAt: Date,
  arrivalAt: Date,
  excludedId?: string,
) {
  await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${driverId}::uuid FOR UPDATE`;
  const conflict = await tx.trip.findFirst({
    where: {
      driverId,
      status: "ACTIVE",
      departureAt: { lt: arrivalAt },
      arrivalAt: { gt: departureAt },
      ...(excludedId ? { id: { not: excludedId } } : {}),
    },
  });
  ensure(
    !conflict,
    409,
    "El chofer ya tiene un viaje en ese horario.",
    "OVERLAPPING_TRIP",
  );
}

export function auditJson(data: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
}
export async function audit(
  tx: Tx,
  actorId: string,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
  reason?: string,
) {
  await tx.audit.create({
    data: {
      actorId,
      entity,
      entityId,
      action,
      ...(before !== undefined ? { before: auditJson(before) } : {}),
      ...(after !== undefined ? { after: auditJson(after) } : {}),
      reason,
    },
  });
}

export async function activeTruck(tx: Tx, id: string) {
  const truck = await tx.truck.findUnique({ where: { id } });
  ensure(truck?.active, 400, "Seleccioná un camión activo.");
  return truck;
}
export async function activeDriver(tx: Tx, id: string) {
  const driver = await tx.driver.findUnique({
    where: { id },
    include: { user: true },
  });
  ensure(driver?.user.active, 400, "Seleccioná un chofer activo.");
  return driver;
}

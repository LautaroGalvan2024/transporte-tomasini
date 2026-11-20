import { Router, type Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type Truck } from "@prisma/client";
import { getDb, lockTrucks, transaction, type Tx } from "./db.js";
import { BUSINESS_TIMEZONE } from "./config.js";
import { currentUser, requireAdmin } from "./auth.js";
import { AppError, ensure } from "./errors.js";
import { ODOMETER_INITIALIZED } from "./odometer.js";
import {
  tripCreate,
  tripUpdate,
  tripQuery,
  monthlyReportQuery,
  versionBody,
  cancelBody,
  uuid,
  km100PreviewBody,
} from "./validation.js";
import { getCalendar } from "./holiday-calendar.js";
import { evaluateKm100, parseKm100Context } from "./holiday-domain.js";
import { tripKm100 } from "./trip-km100.js";
import {
  tripDistance,
  totalTripDistance,
  writeMileage,
} from "./trip-mileage.js";
import { dayStart, dayAfter, validateTripDates } from "./domain.js";
import {
  tripInclude,
  tripDto,
  validateTruckHistory,
  validateDriverOverlap,
  audit,
  activeDriver,
  activeTruck,
  truckDtos,
} from "./models.js";
import writeXlsxFile from "write-excel-file/node";
import { mileageReport, monthlyMileageReport } from "./mileage-report.js";
import {
  activeTrailer,
  lockTrailers,
  validateTrailerOverlap,
} from "./trailer-models.js";

function tripWhere(req: Request) {
  const input = tripQuery.parse(
    Object.fromEntries(
      Object.entries(req.query).filter(([, value]) => value !== ""),
    ),
  );
  ensure(
    !input.from || !input.to || input.from <= input.to,
    400,
    "La fecha desde debe ser anterior a la fecha hasta.",
  );
  const user = currentUser(req);
  if (user.role === "DRIVER" && input.driverId)
    ensure(
      input.driverId === user.driver?.id,
      403,
      "Solo podés consultar tus viajes.",
    );
  const where: Prisma.TripWhereInput = {
    status: "ACTIVE",
    ...(user.role === "DRIVER"
      ? { driverId: user.driver!.id }
      : input.driverId
        ? { driverId: input.driverId }
        : {}),
    ...(input.truckId ? { truckId: input.truckId } : {}),
    ...(input.trailerId ? { trailerId: input.trailerId } : {}),
    ...(input.reviewed
      ? { reviewedAt: input.reviewed === "yes" ? { not: null } : null }
      : {}),
    ...(input.from || input.to
      ? {
          departureAt: {
            ...(input.from ? { gte: dayStart(input.from) } : {}),
            ...(input.to ? { lt: dayAfter(input.to) } : {}),
          },
        }
      : {}),
  };
  return { input, where };
}

async function monthlyTripWhere(
  driverId: string,
  month: string,
): Promise<Prisma.TripWhereInput> {
  // Return UTC wall times so the raw-query date decoder is independent of
  // the database session's TimeZone when reading each bound.
  const [bounds] = await getDb().$queryRaw<{ gte: Date; lt: Date }[]>`
    SELECT (month_start AT TIME ZONE ${BUSINESS_TIMEZONE}) AT TIME ZONE 'UTC' AS gte,
           ((month_start + interval '1 month') AT TIME ZONE ${BUSINESS_TIMEZONE}) AT TIME ZONE 'UTC' AS lt
    FROM (SELECT ${month + "-01"}::timestamp AS month_start) AS calendar`;
  return { driverId, status: "ACTIVE", departureAt: bounds };
}

// Called with the truck locked, in the transaction that creates the trip.
async function ensureOperationalBase(
  tx: Tx,
  truck: Pick<Truck, "id" | "initialOdometer">,
  departureAt: Date,
  initial: number | undefined,
  actorId: string,
) {
  if (
    truck.initialOdometer !== null ||
    (await truckDtos(tx, truck.id))[0].odometer !== null
  ) {
    ensure(
      initial === undefined,
      409,
      "El camión ya tiene una lectura real. Actualizá el formulario antes de guardar.",
      "INITIAL_ODOMETER_CONFLICT",
    );
    return;
  }
  if (initial === undefined)
    throw new AppError(
      400,
      "Ingresá el odómetro del camión al salir para empezar a calcular los vencimientos.",
      "INITIAL_ODOMETER_REQUIRED",
      { initialTruckOdometer: "Ingresá la primera lectura real del camión." },
    );
  await tx.truck.update({
    where: { id: truck.id },
    data: { initialOdometer: initial, initialOdometerAt: departureAt },
  });
  await audit(
    tx,
    actorId,
    "TRUCK",
    truck.id,
    ODOMETER_INITIALIZED,
    { version: 1, odometer: null, odometerAt: null },
    { version: 1, odometer: initial, odometerAt: departureAt.toISOString() },
  );
}

// Removing a reading can leave operational trips without a reference. It
// cannot introduce an overlapping interval or an out-of-order reading.
async function checkRemainingTruckReference(tx: Tx, truckId: string) {
  const dependent = await tx.trip.findFirst({
    where: { truckId, status: "ACTIVE", distanceSource: { not: null } },
    select: { id: true },
  });
  if (dependent) {
    const [truck] = await truckDtos(tx, truckId);
    ensure(
      truck.odometer !== null,
      409,
      "Los viajes que suman kilómetros para mantenimiento necesitan una lectura real del camión.",
      "ODOMETER_REFERENCE_REQUIRED",
    );
  }
}

export function tripsRouter(
  manualDistanceEnabled: boolean,
  operationalDistanceEnabled: boolean,
) {
  const router = Router();
  const requireEnabledMileage = (manualDistanceKm: number | null) =>
    ensure(
      manualDistanceKm === null || manualDistanceEnabled,
      409,
      "La carga con kilómetros directos todavía no está habilitada.",
      "MANUAL_DISTANCE_DISABLED",
    );
  router.post("/km100-preview", async (req, res) => {
    const input = km100PreviewBody.parse(req.body);
    const data = {
      ...writeMileage(
        input,
        currentUser(req).role === "ADMIN" || operationalDistanceEnabled,
      ),
      departureAt: new Date(input.departureAt),
      arrivalAt: new Date(input.arrivalAt),
    };
    requireEnabledMileage(data.manualDistanceKm);
    validateTripDates(data);
    res.json(evaluateKm100(await getCalendar(), data));
  });
  router.get("/", async (req, res) => {
    const { input, where } = tripWhere(req);
    const result = await getDb().$transaction(
      async (tx) => {
        const [items, total, sums] = await Promise.all([
          tx.trip.findMany({
            where,
            include: tripInclude,
            orderBy: [{ departureAt: "desc" }, { id: "desc" }],
            skip: (input.page - 1) * input.pageSize,
            take: input.pageSize,
          }),
          tx.trip.count({ where }),
          tx.trip.aggregate({
            where,
            _sum: {
              endKm: true,
              startKm: true,
              manualDistanceKm: true,
              allowance: true,
            },
          }),
        ]);
        return {
          items: items.map(tripDto),
          total,
          page: input.page,
          pageSize: input.pageSize,
          totals: {
            count: total,
            distanceKm: totalTripDistance(sums._sum),
            allowance: sums._sum.allowance?.toFixed(2) ?? "0.00",
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    res.json(result);
  });
  router.get("/export", requireAdmin, async (req, res) => {
    const format = req.query.format ?? "form";
    ensure(
      format === "form" || format === "detail" || format === "monthly",
      400,
      "Formato de reporte inválido.",
    );
    const monthly =
      format === "monthly" ? monthlyReportQuery.parse(req.query) : null;
    const where = monthly
      ? await monthlyTripWhere(monthly.driverId, monthly.month)
      : tripWhere(req).where;
    const rows = await getDb().trip.findMany({
      where,
      select: {
        driverId: true,
        truckId: true,
        origin: true,
        destination: true,
        departureAt: true,
        arrivalAt: true,
        startKm: true,
        endKm: true,
        manualDistanceKm: true,
        controlCount: true,
        km100: true,
        km100Context: true,
        driver: { select: { cuil: true, user: { select: { name: true } } } },
        truck: { select: { plate: true } },
        trailer: { select: { plate: true } },
        allowance: true,
        reviewedAt: true,
        notes: true,
      },
      orderBy: [{ departureAt: "asc" }, { id: "asc" }],
      take: monthly ? undefined : 50_001,
    });
    if (monthly) {
      ensure(
        rows.length,
        404,
        "El chofer seleccionado no tiene viajes en ese mes.",
      );
      const name =
        rows[0].driver.user.name
          .normalize("NFC")
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-|-$/g, "") || "chofer";
      const buffer = await monthlyMileageReport(rows);
      res.attachment(`Tomasini-${name}-${monthly.month}.xlsx`).send(buffer);
      return;
    }
    ensure(
      rows.length <= 50_000,
      400,
      "Acotá las fechas para exportar hasta 50.000 viajes.",
    );
    if (format === "form") {
      const buffer = await mileageReport(rows);
      res.attachment("planilla-kilometraje-tomasini.xlsx").send(buffer);
      return;
    }
    const headers = [
      "Salida (Argentina)",
      "Llegada (Argentina)",
      "Chofer",
      "Camión",
      "Acoplado",
      "Origen",
      "Destino",
      "Km inicial",
      "Km final",
      "Km recorridos",
      "Viáticos ARS",
      "Estado revisión",
      "Observaciones",
      "Controles",
      "Km al 100%",
      "Estado km al 100%",
    ];
    const displayTime = (date: Date) =>
      new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
    const data = [
      headers.map((value) => ({
        value,
        fontWeight: "bold" as const,
        backgroundColor: "#173452",
        color: "#ffffff",
      })),
      ...rows.map((row) =>
        [
          displayTime(row.departureAt),
          displayTime(row.arrivalAt),
          row.driver.user.name,
          row.truck.plate,
          row.trailer?.plate ?? "Sin acoplado registrado",
          row.origin,
          row.destination,
          row.startKm,
          row.endKm,
          tripDistance(row),
          row.allowance === null ? null : Number(row.allowance),
          row.reviewedAt ? "Revisado" : "Pendiente",
          row.notes,
          row.controlCount,
          row.km100,
          row.km100 === null
            ? "Sin informar"
            : parseKm100Context(row.km100Context)?.mode === "PENDING"
              ? "Provisional: calendario pendiente"
              : "Informado",
        ].map((value, i) =>
          value === null
            ? null
            : typeof value === "number"
              ? { value, type: Number, format: i === 10 ? "#,##0.00" : "#,##0" }
              : { value, type: String },
        ),
      ),
    ];
    const buffer = await writeXlsxFile(data, {
      sheet: "Viajes",
      columns: headers.map((_, i) => ({
        width: [0, 1, 2, 4, 5, 6, 12].includes(i) ? 26 : 18,
      })),
    }).toBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="viajes-tomasini.xlsx"',
    );
    res.send(buffer);
  });
  router.get("/:id", async (req, res) => {
    const row = await getDb().trip.findUnique({
      where: { id: uuid.parse(req.params.id) },
      include: tripInclude,
    });
    ensure(row, 404, "No se encontró el viaje.");
    const user = currentUser(req);
    ensure(
      user.role === "ADMIN" || row.driverId === user.driver?.id,
      404,
      "No se encontró el viaje.",
    );
    res.json(tripDto(row));
  });
  router.post("/", async (req, res) => {
    const input = tripCreate.parse(req.body),
      user = currentUser(req);
    if (user.role === "DRIVER")
      ensure(
        !input.driverId || input.driverId === user.driver?.id,
        403,
        "Solo podés cargar tus propios viajes.",
      );
    const driverId = user.role === "DRIVER" ? user.driver!.id : input.driverId;
    ensure(driverId, 400, "Seleccioná el chofer.");
    const {
      clientRequestId,
      mileageMode: _mode,
      distanceKm: _distance,
      countForMaintenance,
      initialTruckOdometer,
      km100CalendarToken: _calendarToken,
      km100: _km100,
      ...body
    } = input;
    ensure(
      countForMaintenance === undefined || user.role === "ADMIN",
      403,
      "Solo administración puede elegir cómo se contabilizan sus cargas.",
    );
    ensure(
      countForMaintenance === undefined || input.mileageMode === "DISTANCE",
      400,
      "La opción de sumar kilómetros al mantenimiento se usa con kilómetros directos.",
    );
    const addsToMaintenance =
      input.mileageMode === "DISTANCE" &&
      (user.role === "DRIVER" || countForMaintenance === true);
    const distanceSource = addsToMaintenance ? user.role : null;
    ensure(
      initialTruckOdometer === undefined || distanceSource !== null,
      400,
      "La primera lectura del camión solo corresponde a un viaje con kilómetros directos que suma al mantenimiento.",
    );
    const data = {
      ...body,
      // A retry can arrive after the feature was rolled back. Admit writes only
      // after checking the original request and its current ownership below.
      ...writeMileage(input, true),
      distanceSource,
      driverId,
      trailerId: input.trailerId ?? null,
      departureAt: new Date(input.departureAt),
      arrivalAt: new Date(input.arrivalAt),
      allowance: input.allowance ?? null,
      notes: input.notes || null,
    };
    validateTripDates(data);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          driverId,
          truckId: data.truckId,
          origin: data.origin,
          destination: data.destination,
          departureAt: data.departureAt.toISOString(),
          arrivalAt: data.arrivalAt.toISOString(),
          ...(data.manualDistanceKm === null
            ? { startKm: data.startKm, endKm: data.endKm }
            : { mileageMode: "DISTANCE", distanceKm: data.manualDistanceKm }),
          allowance: data.allowance,
          notes: data.notes,
          // Null/omitted keeps the pre-trailer hash, including property order.
          ...(data.trailerId ? { trailerId: data.trailerId } : {}),
          // Preserve older retries without a count, but hash an explicitly reported zero.
          ...(data.controlCount != null
            ? { controlCount: data.controlCount }
            : {}),
          ...(input.km100 != null ? { km100: input.km100 } : {}),
          ...(distanceSource ? { distanceSource, initialTruckOdometer } : {}),
        }),
      )
      .digest("hex");
    const result = await transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clientRequestId}, 0))`;
      const existing = await tx.trip.findUnique({
        where: { clientRequestId },
        include: tripInclude,
      });
      if (existing) {
        ensure(
          existing.createdById === user.id &&
            (user.role === "ADMIN" || existing.driverId === user.driver?.id) &&
            existing.requestHash === requestHash,
          409,
          "Esta solicitud ya se usó para otro viaje. Recargá el formulario.",
          "IDEMPOTENCY_CONFLICT",
        );
        return { trip: existing, replay: true };
      }
      if (distanceSource)
        ensure(
          operationalDistanceEnabled,
          user.role === "DRIVER" ? 403 : 409,
          "La carga de kilómetros directos para mantenimiento todavía no está habilitada.",
          "OPERATIONAL_DISTANCE_DISABLED",
        );
      requireEnabledMileage(data.manualDistanceKm);
      await lockTrucks(tx, [data.truckId]);
      await lockTrailers(tx, data.trailerId ? [data.trailerId] : []);
      const truck = await activeTruck(tx, data.truckId);
      if (distanceSource)
        await ensureOperationalBase(
          tx,
          truck,
          data.departureAt,
          initialTruckOdometer,
          user.id,
        );
      if (data.trailerId) {
        await activeTrailer(tx, data.trailerId);
        await validateTrailerOverlap(
          tx,
          data.trailerId,
          data.departureAt,
          data.arrivalAt,
        );
      }
      await activeDriver(tx, driverId);
      await validateDriverOverlap(
        tx,
        driverId,
        data.departureAt,
        data.arrivalAt,
      );
      await validateTruckHistory(tx, data.truckId, {
        id: randomUUID(),
        ...data,
      });
      const premium = await tripKm100(tx, data, input);
      const trip = await tx.trip.create({
        data: {
          ...data,
          ...premium,
          clientRequestId,
          requestHash,
          createdById: user.id,
        },
        include: tripInclude,
      });
      await audit(
        tx,
        user.id,
        "TRIP",
        trip.id,
        "CREATED",
        undefined,
        tripDto(trip),
      );
      return { trip, replay: false };
    });
    res.status(result.replay ? 200 : 201).json(tripDto(result.trip));
  });
  router.patch("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = tripUpdate.parse(req.body),
      user = currentUser(req);
    const updated = await transaction(async (tx) => {
      const old = await tx.trip.findUnique({
        where: { id },
        include: tripInclude,
      });
      ensure(old, 404, "No se encontró el viaje.");
      ensure(
        user.role === "ADMIN" || old.driverId === user.driver?.id,
        404,
        "No se encontró el viaje.",
      );
      const mileage = writeMileage(
        input,
        user.role === "ADMIN" ||
          (operationalDistanceEnabled &&
            old.distanceSource === "DRIVER" &&
            old.createdById === user.id),
        old,
      );
      requireEnabledMileage(mileage.manualDistanceKm);
      ensure(
        !old.distanceSource || operationalDistanceEnabled,
        409,
        "La corrección de kilómetros directos para mantenimiento todavía no está habilitada.",
        "OPERATIONAL_DISTANCE_DISABLED",
      );
      ensure(
        old.status === "ACTIVE",
        409,
        "Un viaje anulado no se puede modificar.",
      );
      ensure(
        user.role === "ADMIN" || !old.reviewedAt,
        403,
        "Administración debe corregir los viajes ya revisados.",
      );
      ensure(
        old.version === input.version,
        409,
        "El viaje cambió desde que lo abriste. Actualizá y revisá los datos.",
        "VERSION_CONFLICT",
      );
      if (user.role === "DRIVER")
        ensure(
          !input.driverId || input.driverId === user.driver?.id,
          403,
          "No podés cambiar el chofer.",
        );
      const {
        version: _version,
        clientRequestId: _clientRequestId,
        km100: _km100,
        km100CalendarToken: _calendarToken,
        km100Resolve: _resolve,
        mileageMode: _mode,
        distanceKm: _distance,
        ...fields
      } = input;
      const data = {
        ...fields,
        driverId: input.driverId ?? old.driverId,
        truckId: input.truckId ?? old.truckId,
        trailerId:
          input.trailerId === undefined ? old.trailerId : input.trailerId,
        departureAt: input.departureAt
          ? new Date(input.departureAt)
          : old.departureAt,
        arrivalAt: input.arrivalAt ? new Date(input.arrivalAt) : old.arrivalAt,
        ...mileage,
      };
      validateTripDates(data);
      const oldContext = parseKm100Context(old.km100Context);
      if (input.km100Resolve)
        ensure(
          user.role === "ADMIN",
          403,
          "Administración debe resolver el calendario pendiente.",
        );
      ensure(
        oldContext || (input.km100 == null && !input.km100Resolve),
        400,
        "Este viaje es anterior al registro de kilómetros al 100% y conserva sus datos originales.",
        "KM100_LEGACY",
      );
      const recalculate =
        Boolean(oldContext) &&
        (data.departureAt.getTime() !== old.departureAt.getTime() ||
          data.arrivalAt.getTime() !== old.arrivalAt.getTime() ||
          data.startKm !== old.startKm ||
          data.endKm !== old.endKm ||
          data.manualDistanceKm !== old.manualDistanceKm ||
          input.km100 !== undefined ||
          input.km100Resolve);
      await lockTrucks(tx, [old.truckId, data.truckId]);
      await lockTrailers(
        tx,
        [old.trailerId, data.trailerId].filter(
          (id): id is string => id !== null,
        ),
      );
      if (data.truckId !== old.truckId) await activeTruck(tx, data.truckId);
      if (data.trailerId) {
        if (data.trailerId !== old.trailerId)
          await activeTrailer(tx, data.trailerId);
        await validateTrailerOverlap(
          tx,
          data.trailerId,
          data.departureAt,
          data.arrivalAt,
          id,
        );
      }
      if (data.driverId !== old.driverId) await activeDriver(tx, data.driverId);
      await validateDriverOverlap(
        tx,
        data.driverId,
        data.departureAt,
        data.arrivalAt,
        id,
      );
      await validateTruckHistory(
        tx,
        data.truckId,
        { id, ...data, distanceSource: old.distanceSource },
        id,
      );
      const premium = recalculate
        ? await tripKm100(tx, data, input, {
            keepPending: oldContext?.mode === "PENDING",
            resolve: input.km100Resolve,
          })
        : {};
      const row = await tx.trip.update({
        where: { id, version: input.version },
        data: {
          ...data,
          ...premium,
          version: { increment: 1 },
          reviewedAt: null,
          reviewedById: null,
        },
        include: tripInclude,
      });
      if (data.truckId !== old.truckId && old.startKm !== null)
        await checkRemainingTruckReference(tx, old.truckId);
      await audit(
        tx,
        user.id,
        "TRIP",
        id,
        "UPDATED",
        tripDto(old),
        tripDto(row),
      );
      return row;
    });
    res.json(tripDto(updated));
  });
  router.post("/:id/review", requireAdmin, async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = versionBody.parse(req.body);
    const row = await transaction(async (tx) => {
      const old = await tx.trip.findUnique({
        where: { id },
        include: tripInclude,
      });
      ensure(old, 404, "No se encontró el viaje.");
      ensure(
        old.version === input.version,
        409,
        "El viaje cambió. Actualizá antes de revisarlo.",
        "VERSION_CONFLICT",
      );
      ensure(old.status === "ACTIVE", 409, "El viaje está anulado.");
      if (old.reviewedAt) return old;
      ensure(
        parseKm100Context(old.km100Context)?.mode !== "PENDING",
        409,
        "Resolvé los kilómetros al 100% con el calendario confirmado antes de revisar el viaje.",
        "KM100_CALENDAR_PENDING",
      );
      const trip = await tx.trip.update({
        where: { id, version: input.version },
        data: {
          reviewedAt: new Date(),
          reviewedById: currentUser(req).id,
          version: { increment: 1 },
        },
        include: tripInclude,
      });
      await audit(
        tx,
        currentUser(req).id,
        "TRIP",
        id,
        "REVIEWED",
        tripDto(old),
        tripDto(trip),
      );
      return trip;
    });
    res.json(tripDto(row));
  });
  router.post("/:id/cancel", requireAdmin, async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = cancelBody.parse(req.body);
    const row = await transaction(async (tx) => {
      const old = await tx.trip.findUnique({
        where: { id },
        include: tripInclude,
      });
      ensure(old, 404, "No se encontró el viaje.");
      ensure(
        old.version === input.version && old.status === "ACTIVE",
        409,
        "El viaje cambió o ya está anulado. Actualizá la lista.",
        "VERSION_CONFLICT",
      );
      await lockTrucks(tx, [old.truckId]);
      await lockTrailers(tx, old.trailerId ? [old.trailerId] : []);
      const trip = await tx.trip.update({
        where: { id, version: input.version },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelledById: currentUser(req).id,
          cancellationReason: input.reason,
          version: { increment: 1 },
        },
        include: tripInclude,
      });
      if (old.startKm !== null)
        await checkRemainingTruckReference(tx, old.truckId);
      await audit(
        tx,
        currentUser(req).id,
        "TRIP",
        id,
        "CANCELLED",
        tripDto(old),
        tripDto(trip),
        input.reason,
      );
      return trip;
    });
    res.json(tripDto(row));
  });
  router.get("/:id/history", async (req, res) => {
    const id = uuid.parse(req.params.id),
      user = currentUser(req);
    const trip = await getDb().trip.findUnique({ where: { id } });
    ensure(
      trip && (user.role === "ADMIN" || trip.driverId === user.driver?.id),
      404,
      "No se encontró el viaje.",
    );
    const rows = await getDb().audit.findMany({
      where: { entity: "TRIP", entityId: id },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ items: rows });
  });
  return router;
}

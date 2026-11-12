import { Router, type Request } from "express";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getDb, lockTrucks, transaction } from "./db.js";
import { currentUser, requireAdmin } from "./auth.js";
import { ensure } from "./errors.js";
import {
  tripCreate,
  tripUpdate,
  tripQuery,
  versionBody,
  cancelBody,
  uuid,
} from "./validation.js";
import { dayStart, dayAfter, validateTripDates } from "./domain.js";
import {
  tripInclude,
  tripDto,
  validateTruckHistory,
  validateDriverOverlap,
  audit,
  activeDriver,
  activeTruck,
} from "./models.js";
import writeXlsxFile from "write-excel-file/node";
import { mileageReport } from "./mileage-report.js";
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
export function tripsRouter() {
  const router = Router();
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
            _sum: { endKm: true, startKm: true, allowance: true },
          }),
        ]);
        return {
          items: items.map(tripDto),
          total,
          page: input.page,
          pageSize: input.pageSize,
          totals: {
            count: total,
            distanceKm: (sums._sum.endKm ?? 0) - (sums._sum.startKm ?? 0),
            allowance: sums._sum.allowance?.toFixed(2) ?? "0.00",
          },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
    res.json(result);
  });
  router.get("/export", requireAdmin, async (req, res) => {
    const { where } = tripWhere(req);
    const format = req.query.format ?? "form";
    ensure(
      format === "form" || format === "detail",
      400,
      "Formato de reporte inválido.",
    );
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
        controlCount: true,
        driver: { select: { user: { select: { name: true } } } },
        truck: { select: { plate: true } },
        trailer: { select: { plate: true } },
        allowance: true,
        reviewedAt: true,
        notes: true,
      },
      orderBy: [{ departureAt: "asc" }, { id: "asc" }],
      take: 50_001,
    });
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
          row.endKm - row.startKm,
          row.allowance === null ? null : Number(row.allowance),
          row.reviewedAt ? "Revisado" : "Pendiente",
          row.notes,
          row.controlCount,
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
    const { clientRequestId, ...body } = input;
    const data = {
      ...body,
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
          startKm: data.startKm,
          endKm: data.endKm,
          allowance: data.allowance,
          notes: data.notes,
          // Null/omitted keeps the pre-trailer hash, including property order.
          ...(data.trailerId ? { trailerId: data.trailerId } : {}),
          // Preserve older retries without a count, but hash an explicitly reported zero.
          ...(data.controlCount != null
            ? { controlCount: data.controlCount }
            : {}),
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
            existing.requestHash === requestHash,
          409,
          "Esta solicitud ya se usó para otro viaje. Recargá el formulario.",
          "IDEMPOTENCY_CONFLICT",
        );
        return { trip: existing, replay: true };
      }
      await lockTrucks(tx, [data.truckId]);
      await lockTrailers(tx, data.trailerId ? [data.trailerId] : []);
      await activeTruck(tx, data.truckId);
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
      const trip = await tx.trip.create({
        data: { ...data, clientRequestId, requestHash, createdById: user.id },
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
        startKm: input.startKm ?? old.startKm,
        endKm: input.endKm ?? old.endKm,
      };
      validateTripDates(data);
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
      await validateTruckHistory(tx, data.truckId, { id, ...data }, id);
      const row = await tx.trip.update({
        where: { id, version: input.version },
        data: {
          ...data,
          version: { increment: 1 },
          reviewedAt: null,
          reviewedById: null,
        },
        include: tripInclude,
      });
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

import { Router } from "express";
import type { Obligation } from "@prisma/client";
import { getDb, lockTrucks, lockTrailers, transaction } from "./db.js";
import { currentUser, requireAdmin } from "./auth.js";
import { ensure } from "./errors.js";
import {
  obligationCreate,
  obligationUpdate,
  renewalBody,
  uuid,
} from "./validation.js";
import {
  obligationDtos,
  validateTruckHistory,
  audit,
  activeTruck,
  activeDriver,
} from "./models.js";
import { dateOnly, businessDay } from "./domain.js";
import { activeTrailer } from "./trailer-models.js";
import { assertAdminAccess, lockAccessChanges } from "./access-control.js";

function validateOwner(input: {
  truckId?: string | null;
  driverId?: string | null;
  trailerId?: string | null;
  kind: string;
  dueKm?: number | null;
  intervalKm?: number | null;
}) {
  ensure(
    [input.truckId, input.driverId, input.trailerId].filter(Boolean).length ===
      1,
    400,
    "Seleccioná un camión, acoplado o chofer, solo uno.",
  );
  ensure(
    input.truckId || (input.dueKm == null && input.intervalKm == null),
    400,
    "Los vencimientos por kilómetros requieren un camión.",
  );
  ensure(
    input.kind !== "SERVICE" || input.truckId || input.trailerId,
    400,
    "Los servicios requieren un camión o un acoplado.",
  );
}
function validatePerformance(
  performedAt: string,
  odometer: number | null | undefined,
  obligation: {
    kind: string;
    truckId: string | null;
    dueKm?: number | null;
    intervalKm?: number | null;
  },
) {
  ensure(
    new Date(performedAt).getTime() <= Date.now() + 60_000,
    400,
    "El servicio o renovación debe estar realizado.",
  );
  ensure(
    odometer == null || (obligation.kind === "SERVICE" && obligation.truckId),
    400,
    "Solo los servicios de camiones admiten lectura de kilómetros.",
  );
  if (
    obligation.kind === "SERVICE" &&
    (obligation.dueKm != null || obligation.intervalKm != null)
  )
    ensure(
      odometer != null,
      400,
      "Ingresá los kilómetros del service para actualizar su historial.",
    );
}
async function canRead(user: ReturnType<typeof currentUser>, row: Obligation) {
  return (
    user.role === "ADMIN" ||
    row.driverId === user.driver?.id ||
    Boolean(row.truckId && row.truckId === user.driver?.assignedTruckId) ||
    Boolean(
      row.trailerId &&
      user.driver?.assignedTruckId &&
      (await getDb().trailer.findFirst({
        where: {
          id: row.trailerId,
          active: true,
          assignedTruckId: user.driver.assignedTruckId,
        },
        select: { id: true },
      })),
    )
  );
}

export function obligationsRouter() {
  const router = Router();
  router.get("/", async (req, res) =>
    res.json({ items: await obligationDtos(currentUser(req)) }),
  );
  router.get("/:id/renewals", async (req, res) => {
    const id = uuid.parse(req.params.id),
      row = await getDb().obligation.findUnique({ where: { id } });
    ensure(
      row && (await canRead(currentUser(req), row)),
      404,
      "No se encontró el vencimiento.",
    );
    const items = await getDb().renewal.findMany({
      where: { obligationId: id },
      orderBy: [{ performedAt: "desc" }, { createdAt: "desc" }],
    });
    res.json({
      items: items.map((r) => ({
        id: r.id,
        performedAt: r.performedAt.toISOString(),
        odometer: r.odometer,
        nextDueDate: dateOnly(r.nextDueDate),
        nextDueKm: r.nextDueKm,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
  router.use(requireAdmin);
  router.post("/", async (req, res) => {
    const input = obligationCreate.parse(req.body),
      user = currentUser(req);
    validateOwner(input);
    const { initialRecord, ...body } = input;
    const id = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      const settings = await tx.setting.findUniqueOrThrow({
        where: { id: "main" },
      });
      if (body.truckId) {
        await lockTrucks(tx, [body.truckId]);
        await activeTruck(tx, body.truckId);
      }
      if (body.driverId) await activeDriver(tx, body.driverId);
      if (body.trailerId) {
        await lockTrailers(tx, [body.trailerId]);
        await activeTrailer(tx, body.trailerId);
      }
      const row = await tx.obligation.create({
        data: {
          ...body,
          dueDate: body.dueDate ? new Date(body.dueDate) : null,
          warningDays: body.warningDays ?? settings.warningDays,
          warningKm: body.warningKm ?? settings.warningKm,
        },
      });
      if (initialRecord) {
        validatePerformance(
          initialRecord.performedAt,
          initialRecord.odometer,
          row,
        );
        if (initialRecord.odometer != null && row.truckId)
          await validateTruckHistory(tx, row.truckId, undefined, undefined, {
            at: new Date(initialRecord.performedAt),
            km: initialRecord.odometer,
            label: row.title,
          });
        await tx.renewal.create({
          data: {
            ...initialRecord,
            performedAt: new Date(initialRecord.performedAt),
            obligationId: row.id,
            createdById: user.id,
            nextDueDate: row.dueDate,
            nextDueKm: row.dueKm,
          },
        });
      }
      await audit(tx, user.id, "OBLIGATION", row.id, "CREATED", undefined, {
        ...row,
        initialRecord,
      });
      return row.id;
    });
    res.status(201).json((await obligationDtos(user)).find((o) => o.id === id));
  });
  router.patch("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = obligationUpdate.parse(req.body),
      user = currentUser(req);
    await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      const old = await tx.obligation.findUnique({
        where: { id },
        include: { _count: { select: { renewals: true } } },
      });
      ensure(old, 404, "No se encontró el vencimiento.");
      ensure(
        old.version === input.version,
        409,
        "El vencimiento cambió. Actualizá y revisá los datos.",
        "VERSION_CONFLICT",
      );
      const { version: _version, ...fields } = input;
      const owner = { ...old, ...fields };
      validateOwner(owner);
      ensure(
        old._count.renewals === 0 ||
          (old.kind === owner.kind &&
            old.truckId === owner.truckId &&
            old.driverId === owner.driverId &&
            old.trailerId === owner.trailerId),
        409,
        "Con historial registrado no se puede cambiar el tipo ni el camión, acoplado o chofer. Creá otro vencimiento.",
      );
      if (owner.truckId) {
        await lockTrucks(tx, [owner.truckId]);
        if (owner.truckId !== old.truckId) await activeTruck(tx, owner.truckId);
      }
      if (owner.driverId && owner.driverId !== old.driverId)
        await activeDriver(tx, owner.driverId);
      if (owner.trailerId) {
        await lockTrailers(tx, [owner.trailerId]);
        if (owner.trailerId !== old.trailerId)
          await activeTrailer(tx, owner.trailerId);
      }
      const row = await tx.obligation.update({
        where: { id, version: input.version },
        data: {
          ...fields,
          ...(input.dueDate !== undefined
            ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
            : {}),
          version: { increment: 1 },
        },
      });
      await audit(tx, user.id, "OBLIGATION", id, "UPDATED", old, row);
    });
    res.json((await obligationDtos(user)).find((o) => o.id === id));
  });
  router.post("/:id/renewals", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = renewalBody.parse(req.body),
      user = currentUser(req);
    await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      const old = await tx.obligation.findUnique({
        where: { id },
        include: { renewals: { orderBy: { performedAt: "desc" }, take: 1 } },
      });
      ensure(old?.active, 404, "No se encontró un vencimiento activo.");
      ensure(
        old.version === input.version,
        409,
        "El vencimiento cambió. Actualizá antes de renovar.",
        "VERSION_CONFLICT",
      );
      validatePerformance(input.performedAt, input.odometer, old);
      const performedAt = new Date(input.performedAt);
      ensure(
        !old.renewals[0] || performedAt > old.renewals[0].performedAt,
        400,
        "La renovación debe ser posterior al último registro.",
      );
      ensure(
        "nextDueDate" in input || "nextDueKm" in input,
        400,
        "Confirmá el próximo vencimiento o dejalo explícitamente pendiente.",
      );
      if (input.nextDueDate)
        ensure(
          input.nextDueDate >= businessDay(performedAt),
          400,
          "La próxima fecha no puede ser anterior a la renovación.",
        );
      if (input.nextDueKm != null) {
        ensure(
          old.truckId,
          400,
          "Los vencimientos por kilómetros requieren un camión.",
        );
        if (input.odometer != null)
          ensure(
            input.nextDueKm > input.odometer,
            400,
            "El próximo kilometraje debe superar la lectura del service.",
          );
      }
      if (old.truckId) {
        await lockTrucks(tx, [old.truckId]);
        await activeTruck(tx, old.truckId);
        if (input.odometer != null)
          await validateTruckHistory(tx, old.truckId, undefined, undefined, {
            at: performedAt,
            km: input.odometer,
            label: old.title,
          });
      }
      if (old.driverId) await activeDriver(tx, old.driverId);
      if (old.trailerId) {
        await lockTrailers(tx, [old.trailerId]);
        await activeTrailer(tx, old.trailerId);
      }
      const renewal = await tx.renewal.create({
        data: {
          obligationId: id,
          performedAt,
          odometer: input.odometer,
          nextDueDate: input.nextDueDate ? new Date(input.nextDueDate) : null,
          nextDueKm: input.nextDueKm,
          notes: input.notes,
          createdById: user.id,
        },
      });
      const row = await tx.obligation.update({
        where: { id, version: input.version },
        data: {
          dueDate: renewal.nextDueDate,
          dueKm: renewal.nextDueKm,
          version: { increment: 1 },
        },
      });
      await audit(tx, user.id, "OBLIGATION", id, "RENEWED", old, {
        ...row,
        renewal,
      });
    });
    res.status(201).json((await obligationDtos(user)).find((o) => o.id === id));
  });
  return router;
}

import { Router } from "express";
import { currentUser, requireAdmin } from "./auth.js";
import { assertAdminAccess, lockAccessChanges } from "./access-control.js";
import { getDb, lockTrucks, lockTrailers, transaction, type Tx } from "./db.js";
import { ensure } from "./errors.js";
import { activeTruck, audit } from "./models.js";
import { availableFleetPlate, trailerDtos } from "./trailer-models.js";
import {
  trailerCreate,
  trailerUpdate,
  trailerAssignment,
  uuid,
} from "./validation.js";

async function availableTruck(tx: Tx, truckId: string, trailerId?: string) {
  await activeTruck(tx, truckId);
  const occupied = await tx.trailer.findFirst({
    where: {
      assignedTruckId: truckId,
      ...(trailerId ? { id: { not: trailerId } } : {}),
    },
  });
  ensure(
    !occupied,
    409,
    "Este camión ya tiene un acoplado asignado. Desasignalo antes de continuar.",
    "TRAILER_ASSIGNMENT_CONFLICT",
  );
}

export function trailersRouter() {
  const router = Router();
  router.get("/", async (req, res) =>
    res.json({
      items: await trailerDtos(getDb(), undefined, currentUser(req)),
    }),
  );
  router.use(requireAdmin);
  router.get("/:id/history", async (req, res) => {
    const id = uuid.parse(req.params.id);
    ensure(
      await getDb().trailer.findUnique({ where: { id } }),
      404,
      "No se encontró el acoplado.",
    );
    const items = await getDb().audit.findMany({
      where: { entity: "TRAILER", entityId: id },
      include: { actor: { select: { name: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    res.json({ items });
  });
  router.post("/", async (req, res) => {
    const input = trailerCreate.parse(req.body),
      actor = currentUser(req);
    const result = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      await availableFleetPlate(tx, input.plate);
      if (input.assignedTruckId) {
        await lockTrucks(tx, [input.assignedTruckId]);
        await availableTruck(tx, input.assignedTruckId);
      }
      const row = await tx.trailer.create({ data: input });
      await audit(tx, actor.id, "TRAILER", row.id, "CREATED", undefined, row);
      return (await trailerDtos(tx, row.id))[0];
    });
    res.status(201).json(result);
  });
  router.patch("/:id/truck", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = trailerAssignment.parse(req.body),
      actor = currentUser(req);
    const result = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      const old = await tx.trailer.findUnique({ where: { id } });
      ensure(old, 404, "No se encontró el acoplado.");
      await lockTrucks(
        tx,
        [old.assignedTruckId, input.assignedTruckId].filter(
          (value): value is string => value !== null,
        ),
      );
      await lockTrailers(tx, [id]);
      ensure(
        old.version === input.version,
        409,
        "El acoplado cambió. Actualizá y revisá la asignación.",
        "VERSION_CONFLICT",
      );
      ensure(
        old.active,
        409,
        "Reactivá el acoplado antes de cambiar su camión.",
      );
      if (input.assignedTruckId)
        await availableTruck(tx, input.assignedTruckId, id);
      if (old.assignedTruckId === input.assignedTruckId)
        return (await trailerDtos(tx, id))[0];
      const row = await tx.trailer.update({
        where: { id, version: input.version },
        data: {
          assignedTruckId: input.assignedTruckId,
          version: { increment: 1 },
        },
      });
      await audit(
        tx,
        actor.id,
        "TRAILER",
        id,
        input.assignedTruckId ? "TRUCK_ASSIGNED" : "TRUCK_UNASSIGNED",
        old,
        row,
      );
      return (await trailerDtos(tx, id))[0];
    });
    res.json(result);
  });
  router.patch("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = trailerUpdate.parse(req.body),
      actor = currentUser(req);
    const result = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      const old = await tx.trailer.findUnique({ where: { id } });
      ensure(old, 404, "No se encontró el acoplado.");
      if (old.assignedTruckId) await lockTrucks(tx, [old.assignedTruckId]);
      await lockTrailers(tx, [id]);
      ensure(
        old.version === input.version,
        409,
        "El acoplado cambió. Actualizá y revisá los datos.",
        "VERSION_CONFLICT",
      );
      if (input.plate) await availableFleetPlate(tx, input.plate, id);
      const { version: _version, ...data } = input;
      const row = await tx.trailer.update({
        where: { id, version: input.version },
        data: {
          ...data,
          ...(input.active === false ? { assignedTruckId: null } : {}),
          version: { increment: 1 },
        },
      });
      if (input.active === false && old.assignedTruckId)
        await audit(
          tx,
          actor.id,
          "TRAILER",
          id,
          "TRUCK_UNASSIGNED",
          old,
          row,
          "Acoplado dado de baja.",
        );
      await audit(
        tx,
        actor.id,
        "TRAILER",
        id,
        input.active === false
          ? "DEACTIVATED"
          : input.active === true && !old.active
            ? "REACTIVATED"
            : "UPDATED",
        old,
        row,
      );
      return (await trailerDtos(tx, id))[0];
    });
    res.json(result);
  });
  router.delete("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = currentUser(req);
    const result = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      const old = await tx.trailer.findUnique({ where: { id } });
      ensure(old, 404, "No se encontró el acoplado.");
      if (old.assignedTruckId) await lockTrucks(tx, [old.assignedTruckId]);
      await lockTrailers(tx, [id]);
      if (old.active) {
        const row = await tx.trailer.update({
          where: { id },
          data: {
            active: false,
            assignedTruckId: null,
            version: { increment: 1 },
          },
        });
        if (old.assignedTruckId)
          await audit(
            tx,
            actor.id,
            "TRAILER",
            id,
            "TRUCK_UNASSIGNED",
            old,
            row,
            "Acoplado dado de baja.",
          );
        await audit(tx, actor.id, "TRAILER", id, "DEACTIVATED", old, row);
      }
      return (await trailerDtos(tx, id))[0];
    });
    res.json(result);
  });
  return router;
}

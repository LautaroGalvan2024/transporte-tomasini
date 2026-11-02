import { Router } from "express";
import { z } from "zod";
import { getDb, lockTrucks, transaction, type Tx } from "./db.js";
import { currentUser, requireAdmin } from "./auth.js";
import { ensure } from "./errors.js";
import {
  truckCreate,
  truckUpdate,
  driverCreate,
  driverUpdate,
  password,
  uuid,
} from "./validation.js";
import { truckDtos, driverDtos, audit, activeTruck } from "./models.js";
import { hashPassword } from "./password.js";
import { revokeDriverInvitations } from "./invitations.js";
import { assertAdminAccess, lockAccessChanges } from "./access-control.js";
import { odometerBody, ODOMETER_ADJUSTED } from "./odometer.js";

async function unassignTruck(tx: Tx, truckId: string, actorId: string) {
  const drivers = await tx.driver.findMany({
    where: { assignedTruckId: truckId },
    select: { id: true },
  });
  await tx.driver.updateMany({
    where: { assignedTruckId: truckId },
    data: { assignedTruckId: null },
  });
  for (const driver of drivers)
    await audit(
      tx,
      actorId,
      "DRIVER",
      driver.id,
      "TRUCK_UNASSIGNED",
      { assignedTruckId: truckId },
      { assignedTruckId: null },
      "Camión dado de baja.",
    );
}

export function trucksRouter() {
  const router = Router();
  router.get("/", async (_req, res) => res.json({ items: await truckDtos() }));
  router.use(requireAdmin);
  router.post("/", async (req, res) => {
    const data = truckCreate.parse(req.body),
      user = currentUser(req);
    ensure(
      new Date(data.initialOdometerAt).getTime() <= Date.now() + 60_000,
      400,
      "La lectura inicial no puede ser futura.",
    );
    const id = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      const truck = await tx.truck.create({
        data: { ...data, initialOdometerAt: new Date(data.initialOdometerAt) },
      });
      await audit(tx, user.id, "TRUCK", truck.id, "CREATED", undefined, truck);
      return truck.id;
    });
    res.status(201).json((await truckDtos()).find((t) => t.id === id));
  });
  router.patch("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = truckUpdate.parse(req.body);
    await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, currentUser(req).id, req.sessionId);
      await lockTrucks(tx, [id]);
      const old = await tx.truck.findUnique({ where: { id } });
      ensure(old, 404, "No se encontró el camión.");
      const row = await tx.truck.update({ where: { id }, data: input });
      if (input.active === false)
        await unassignTruck(tx, id, currentUser(req).id);
      await audit(tx, currentUser(req).id, "TRUCK", id, "UPDATED", old, row);
    });
    res.json((await truckDtos()).find((t) => t.id === id));
  });
  router.delete("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = currentUser(req);
    const row = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      await lockTrucks(tx, [id]);
      const old = await tx.truck.findUnique({ where: { id } });
      ensure(old, 404, "No se encontró el camión.");
      if (old.active) {
        const updated = await tx.truck.update({
          where: { id },
          data: { active: false },
        });
        await unassignTruck(tx, id, actor.id);
        await audit(tx, actor.id, "TRUCK", id, "DEACTIVATED", old, updated);
      }
      return (await truckDtos(tx, id))[0];
    });
    res.json(row);
  });
  router.patch("/:id/odometer", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = odometerBody.parse(req.body),
      actor = currentUser(req);
    const result = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      await lockTrucks(tx, [id]);
      const current = (await truckDtos(tx, id))[0];
      ensure(current, 404, "No se encontró el camión.");
      ensure(
        current.active,
        409,
        "Reactivá el camión antes de corregir su odómetro.",
      );
      ensure(
        current.odometer === input.expectedOdometer &&
          Date.parse(current.odometerAt) ===
            Date.parse(input.expectedOdometerAt),
        409,
        "El odómetro cambió desde que lo abriste. Actualizá la lectura y revisá tu corrección.",
        "ODOMETER_VERSION_CONFLICT",
      );
      if (current.odometer === input.odometer) return current;
      const now = Date.now();
      ensure(
        Date.parse(current.odometerAt) <= now,
        409,
        "Hay una lectura con fecha futura. Revisá esa fecha antes de corregir el odómetro.",
        "FUTURE_ODOMETER_READING",
      );
      const at = new Date(Math.max(now, Date.parse(current.odometerAt) + 1));
      await tx.audit.create({
        data: {
          entity: "TRUCK",
          entityId: id,
          action: ODOMETER_ADJUSTED,
          actorId: actor.id,
          createdAt: at,
          before: {
            version: 1,
            odometer: current.odometer,
            odometerAt: current.odometerAt,
          },
          after: {
            version: 1,
            odometer: input.odometer,
            odometerAt: at.toISOString(),
          },
        },
      });
      return (await truckDtos(tx, id))[0];
    });
    res.json(result);
  });
  return router;
}
export function driversRouter() {
  const router = Router();
  router.get("/", async (req, res) =>
    res.json({ items: await driverDtos(currentUser(req)) }),
  );
  router.use(requireAdmin);
  router.post("/", async (req, res) => {
    const input = driverCreate.parse(req.body),
      user = currentUser(req);
    const passwordHash = await hashPassword(input.password);
    const id = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      if (input.assignedTruckId) await activeTruck(tx, input.assignedTruckId);
      const account = await tx.user.create({
        data: {
          username: input.username,
          name: input.name,
          passwordHash,
          role: "DRIVER",
          mustChangePassword: true,
          driver: {
            create: {
              phone: input.phone,
              assignedTruckId: input.assignedTruckId,
            },
          },
        },
        include: { driver: true },
      });
      const driver = account.driver!;
      await audit(tx, user.id, "DRIVER", driver.id, "CREATED", undefined, {
        name: account.name,
        username: account.username,
        phone: driver.phone,
        assignedTruckId: driver.assignedTruckId,
      });
      return driver.id;
    });
    res.status(201).json((await driverDtos(user)).find((d) => d.id === id));
  });
  router.patch("/:id", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = driverUpdate.parse(req.body),
      user = currentUser(req);
    await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${id}::uuid FOR UPDATE`;
      const old = await tx.driver.findUnique({
        where: { id },
        include: { user: true },
      });
      ensure(old, 404, "No se encontró el chofer.");
      ensure(
        old.user.role === "DRIVER",
        409,
        "Este perfil pertenece a un administrador. Gestioná su acceso desde Usuarios.",
        "DRIVER_ROLE_REQUIRED",
      );
      if (input.assignedTruckId) await activeTruck(tx, input.assignedTruckId);
      await tx.user.update({
        where: { id: old.userId },
        data: {
          name: input.name,
          username: input.username,
          active: input.active,
        },
      });
      const row = await tx.driver.update({
        where: { id },
        data: {
          phone: input.phone,
          assignedTruckId:
            input.active === false ? null : input.assignedTruckId,
        },
        include: { user: true },
      });
      if (
        input.active === false ||
        (input.username && input.username !== old.user.username)
      )
        await tx.session.deleteMany({ where: { userId: old.userId } });
      if (
        input.active === false ||
        (input.username && input.username !== old.user.username)
      )
        await revokeDriverInvitations(
          tx,
          id,
          user.id,
          "Cambió el estado o usuario del chofer.",
        );
      const safe = (d: typeof old) => ({
        name: d.user.name,
        username: d.user.username,
        active: d.user.active,
        phone: d.phone,
        assignedTruckId: d.assignedTruckId,
      });
      await audit(tx, user.id, "DRIVER", id, "UPDATED", safe(old), safe(row));
    });
    res.json((await driverDtos(user)).find((d) => d.id === id));
  });
  router.post("/:id/password", async (req, res) => {
    const id = uuid.parse(req.params.id),
      input = z.object({ password }).strict().parse(req.body),
      user = currentUser(req);
    const passwordHash = await hashPassword(input.password);
    await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${id}::uuid FOR UPDATE`;
      const driver = await tx.driver.findUnique({
        where: { id },
        include: { user: true },
      });
      ensure(driver, 404, "No se encontró el chofer.");
      ensure(
        driver.user.role === "DRIVER",
        409,
        "Este perfil pertenece a un administrador. Gestioná su acceso desde Usuarios.",
        "DRIVER_ROLE_REQUIRED",
      );
      await tx.user.update({
        where: { id: driver.userId },
        data: { passwordHash, mustChangePassword: true },
      });
      await tx.session.deleteMany({ where: { userId: driver.userId } });
      await revokeDriverInvitations(
        tx,
        id,
        user.id,
        "Contraseña restablecida por administración.",
      );
      await audit(tx, user.id, "DRIVER", id, "PASSWORD_RESET");
    });
    res.sendStatus(204);
  });
  return router;
}

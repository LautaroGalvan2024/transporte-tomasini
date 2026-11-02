import { Router } from "express";
import { z } from "zod";
import { getDb, transaction } from "./db.js";
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
      const old = await tx.truck.findUnique({ where: { id } });
      ensure(old, 404, "No se encontró el camión.");
      const row = await tx.truck.update({ where: { id }, data: input });
      if (input.active === false)
        await tx.driver.updateMany({
          where: { assignedTruckId: id },
          data: { assignedTruckId: null },
        });
      await audit(tx, currentUser(req).id, "TRUCK", id, "UPDATED", old, row);
    });
    res.json((await truckDtos()).find((t) => t.id === id));
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
      await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${id}::uuid FOR UPDATE`;
      const old = await tx.driver.findUnique({
        where: { id },
        include: { user: true },
      });
      ensure(old, 404, "No se encontró el chofer.");
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
        data: { phone: input.phone, assignedTruckId: input.assignedTruckId },
        include: { user: true },
      });
      if (
        input.active === false ||
        (input.username && input.username !== old.user.username)
      )
        await tx.session.deleteMany({ where: { userId: old.userId } });
      if (input.active === false)
        await revokeDriverInvitations(
          tx,
          id,
          user.id,
          "Chofer desactivado por administración.",
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
      await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${id}::uuid FOR UPDATE`;
      const driver = await tx.driver.findUnique({ where: { id } });
      ensure(driver, 404, "No se encontró el chofer.");
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

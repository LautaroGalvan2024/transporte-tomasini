import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getDb, assertDatabaseScope, disconnect } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";
import { obligationDtos } from "../src/models.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";

test(
  "vencimientos de dueños inactivos conservan historial y salen del tablero operativo",
  { skip: !enabled, timeout: 60_000 },
  async () => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    const password = "Clave-larga-pruebas-owner-2026";
    const passwordHash = await hashPassword(password);
    const users: string[] = [],
      drivers: string[] = [],
      trucks: string[] = [];
    const obligations: string[] = [];
    try {
      const admin = await db.user.create({
        data: {
          username: `owner_admin_${suffix}`,
          name: "Admin owner test",
          passwordHash,
          role: "ADMIN",
          mustChangePassword: false,
        },
      });
      users.push(admin.id);
      const inactiveDriver = await db.user.create({
        data: {
          username: `owner_inactive_${suffix}`,
          name: "Chofer inactivo",
          passwordHash,
          role: "DRIVER",
          active: false,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      const promotedDriver = await db.user.create({
        data: {
          username: `owner_promoted_${suffix}`,
          name: "Antiguo chofer administrador",
          passwordHash,
          role: "ADMIN",
          active: true,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      users.push(inactiveDriver.id, promotedDriver.id);
      drivers.push(inactiveDriver.driver!.id, promotedDriver.driver!.id);
      for (const active of [true, false]) {
        const truck = await db.truck.create({
          data: {
            plate: `O${active ? "A" : "I"}${suffix.toUpperCase()}`,
            label: `Owner test ${active}`,
            active,
            initialOdometer: 1000,
            initialOdometerAt: new Date("2020-01-01T12:00:00Z"),
          },
        });
        trucks.push(truck.id);
      }
      for (const owner of [
        { truckId: trucks[0] },
        { truckId: trucks[1] },
        { driverId: drivers[0] },
        { driverId: drivers[1] },
      ]) {
        const obligation = await db.obligation.create({
          data: {
            title: `Owner obligation ${obligations.length}`,
            kind: "DOCUMENT",
            dueDate: new Date("2020-01-02"),
            ...owner,
          },
        });
        obligations.push(obligation.id);
      }
      const items = (await obligationDtos()).filter((item) =>
        obligations.includes(item.id),
      );
      assert.equal(
        items.length,
        4,
        "La consulta administrativa conserva todos los registros.",
      );
      assert.ok(
        items.every((item) => item.active),
        "No se cambia el estado almacenado del vencimiento.",
      );
      assert.equal(
        items.find((item) => item.id === obligations[0])?.ownerActive,
        true,
      );
      for (const id of obligations.slice(1)) {
        assert.equal(items.find((item) => item.id === id)?.ownerActive, false);
      }
      const agent = request.agent(createApp());
      const login = await agent
        .post("/api/auth/login")
        .set("Origin", getConfig().origin)
        .set("X-Tomasini-Request", "1")
        .send({ username: admin.username, password });
      assert.equal(login.status, 200);
      for (const id of obligations.slice(1)) {
        const renewal = await agent
          .post(`/api/obligations/${id}/renewals`)
          .set("Origin", getConfig().origin)
          .set("X-Tomasini-Request", "1")
          .send({
            version: 1,
            performedAt: new Date().toISOString(),
            nextDueDate: new Date(Date.now() + 86_400_000)
              .toISOString()
              .slice(0, 10),
          });
        assert.equal(
          renewal.status,
          400,
          "La API también rechaza renovaciones de un dueño inactivo o que ya no es chofer.",
        );
      }
      assert.equal(
        await db.renewal.count({
          where: { obligationId: { in: obligations } },
        }),
        0,
      );
      const dashboard = await agent.get("/api/dashboard");
      assert.equal(dashboard.status, 200);
      const ids = dashboard.body.obligations.map(
        (item: { id: string }) => item.id,
      );
      assert.ok(ids.includes(obligations[0]));
      assert.ok(obligations.slice(1).every((id) => !ids.includes(id)));

      await db.truck.update({
        where: { id: trucks[1] },
        data: { active: true },
      });
      const restored = (await obligationDtos()).find(
        (item) => item.id === obligations[1],
      );
      assert.equal(
        restored?.ownerActive,
        true,
        "Reactivar al dueño recupera el control sin recrear historial.",
      );
      assert.equal(restored?.active, true);
    } finally {
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.obligation.deleteMany({ where: { id: { in: obligations } } });
      await db.driver.deleteMany({ where: { id: { in: drivers } } });
      await db.truck.deleteMany({ where: { id: { in: trucks } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await disconnect();
    }
  },
);

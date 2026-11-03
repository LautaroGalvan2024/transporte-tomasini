import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";
import { businessDay, dayStart } from "../src/domain.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "camión habitual de administradores: permisos, identidad operativa, roles e historial",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      origin = getConfig().origin;
    const prefix = `truck_user_${randomUUID().slice(0, 8)}_`;
    const password = "Clave-pruebas-camion-admin-2026",
      passwordHash = await hashPassword(password);
    const users: string[] = [],
      trucks: string[] = [],
      obligations: string[] = [];
    try {
      const a = await db.user.create({
        data: {
          username: prefix + "a",
          name: "Admin conductor A",
          role: "ADMIN",
          passwordHash,
          mustChangePassword: false,
        },
      });
      users.push(a.id);
      const b = await db.user.create({
        data: {
          username: prefix + "b",
          name: "Admin B",
          role: "ADMIN",
          passwordHash,
          mustChangePassword: false,
        },
      });
      users.push(b.id);
      const d = await db.user.create({
        data: {
          username: prefix + "d",
          name: "Chofer",
          role: "DRIVER",
          passwordHash,
          mustChangePassword: false,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      users.push(d.id);
      const inactive = await db.user.create({
        data: {
          username: prefix + "off",
          name: "Admin inactivo",
          role: "ADMIN",
          active: false,
          passwordHash,
          mustChangePassword: false,
        },
      });
      users.push(inactive.id);
      for (const active of [true, false]) {
        const truck = await db.truck.create({
          data: {
            plate: `A${randomUUID().replaceAll("-", "").slice(0, 11).toUpperCase()}`,
            label: "Camión admin",
            active,
            initialOdometer: 1000,
            initialOdometerAt: new Date(Date.now() - 86_400_000),
          },
        });
        trucks.push(truck.id);
      }
      const agentA = request.agent(app),
        agentB = request.agent(app),
        agentD = request.agent(app),
        anonymous = request.agent(app);
      const patch = (agent: typeof agentA, path: string, body: object) =>
        agent
          .patch(`/api${path}`)
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1")
          .send(body);
      const post = (agent: typeof agentA, path: string, body: object) =>
        agent
          .post(`/api${path}`)
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1")
          .send(body);
      const remove = (agent: typeof agentA, path: string) =>
        agent
          .delete(`/api${path}`)
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1");
      const assign = (
        agent: typeof agentA,
        id: string,
        assignedTruckId: string | null,
      ) => patch(agent, `/users/${id}/truck`, { assignedTruckId });
      async function login(agent: typeof agentA, username: string) {
        assert.equal(
          (await post(agent, "/auth/login", { username, password })).status,
          200,
        );
      }
      await login(agentA, a.username);
      await login(agentB, b.username);
      await login(agentD, d.username);
      let adminDriverId = "";
      await t.test(
        "permiso administrativo, origen, DTO estricto y destinos activos",
        async () => {
          assert.equal((await assign(anonymous, a.id, trucks[0])).status, 401);
          assert.equal((await assign(agentD, d.id, trucks[0])).status, 403);
          assert.equal(
            (
              await agentA
                .patch(`/api/users/${a.id}/truck`)
                .send({ assignedTruckId: trucks[0] })
            ).status,
            403,
          );
          for (const body of [
            {},
            { assignedTruckId: "invalid" },
            { assignedTruckId: null, role: "DRIVER" },
            { assignedTruckId: null, actorId: b.id },
          ])
            assert.equal(
              (await patch(agentA, `/users/${a.id}/truck`, body)).status,
              400,
            );
          assert.equal(
            (await assign(agentA, inactive.id, trucks[0])).status,
            409,
          );
          assert.equal((await assign(agentA, a.id, trucks[1])).status, 400);
          assert.equal((await assign(agentA, a.id, randomUUID())).status, 400);
          assert.equal(
            (await assign(agentA, randomUUID(), trucks[0])).status,
            404,
          );
          assert.equal(
            await db.driver.count({
              where: { userId: { in: [a.id, b.id, inactive.id] } },
            }),
            0,
          );
        },
      );
      await t.test(
        "null sin perfil no crea registros y autoasignación es idempotente sin cerrar sesión",
        async () => {
          const empty = await assign(agentA, b.id, null);
          assert.equal(empty.status, 200);
          assert.equal(empty.body.driverId, null);
          assert.equal(empty.body.assignedTruckId, null);
          assert.equal(await db.driver.count({ where: { userId: b.id } }), 0);
          const assigned = await assign(agentA, a.id, trucks[0]);
          assert.equal(assigned.status, 200);
          assert.equal(assigned.body.role, "ADMIN");
          assert.equal(assigned.body.assignedTruckId, trucks[0]);
          assert.ok(assigned.body.driverId);
          adminDriverId = assigned.body.driverId;
          const repeated = await assign(agentA, a.id, trucks[0]);
          assert.equal(repeated.body.driverId, adminDriverId);
          assert.equal(await db.driver.count({ where: { userId: a.id } }), 1);
          assert.equal(
            await db.audit.count({
              where: {
                entity: "USER",
                entityId: a.id,
                action: "TRUCK_ASSIGNED",
              },
            }),
            1,
          );
          const me = await agentA.get("/api/auth/me");
          assert.equal(me.status, 200);
          assert.equal(me.body.driverId, adminDriverId);
          const operators = await agentA.get("/api/drivers");
          const operator = operators.body.items.find(
            (item: { id: string }) => item.id === adminDriverId,
          );
          assert.equal(operator.active, true);
          assert.equal(operator.role, "ADMIN");
          assert.equal(operator.assignedTruckId, trucks[0]);
          const dashboard = await agentA.get("/api/dashboard");
          assert.equal(dashboard.status, 200);
          assert.equal(dashboard.body.currentDriver.id, adminDriverId);
          assert.equal(dashboard.body.assignedTruck.id, trucks[0]);
        },
      );
      await t.test(
        "perfil ADMIN registra viajes y documentación sin abrir endpoints legacy de credenciales",
        async () => {
          const now = Date.now();
          const ownTrip = await post(agentA, "/trips", {
            clientRequestId: randomUUID(),
            driverId: adminDriverId,
            truckId: trucks[0],
            origin: "Origen admin",
            destination: "Destino admin",
            departureAt: new Date(now - 5000).toISOString(),
            arrivalAt: new Date(now - 4000).toISOString(),
            startKm: 1000,
            endKm: 1020,
          });
          assert.equal(ownTrip.status, 201, JSON.stringify(ownTrip.body));
          assert.equal(ownTrip.body.driverId, adminDriverId);
          const otherTrip = await post(agentD, "/trips", {
            clientRequestId: randomUUID(),
            truckId: trucks[0],
            origin: "Origen chofer",
            destination: "Destino chofer",
            departureAt: new Date(now - 3000).toISOString(),
            arrivalAt: new Date(now - 2000).toISOString(),
            startKm: 1020,
            endKm: 1030,
          });
          assert.equal(otherTrip.status, 201);
          const document = await post(agentA, "/obligations", {
            title: "Licencia administrador conductor",
            kind: "DOCUMENT",
            driverId: adminDriverId,
            dueDate: "2020-01-01",
          });
          assert.equal(document.status, 201);
          obligations.push(document.body.id);
          assert.equal(document.body.ownerActive, true);
          const renewal = await post(
            agentA,
            `/obligations/${document.body.id}/renewals`,
            {
              version: document.body.version,
              performedAt: new Date().toISOString(),
              nextDueDate: new Date(Date.now() + 86_400_000)
                .toISOString()
                .slice(0, 10),
            },
          );
          assert.equal(renewal.status, 201);
          const dashboard = await agentA.get("/api/dashboard");
          const globalCount = await db.trip.count({
            where: {
              status: "ACTIVE",
              departureAt: { gte: dayStart(`${businessDay().slice(0, 7)}-01`) },
            },
          });
          assert.equal(
            dashboard.body.stats.tripsThisMonth,
            globalCount,
            "El administrador conserva estadísticas globales.",
          );
          assert.equal(
            (
              await post(agentA, "/invitations", {
                role: "DRIVER",
                driverId: adminDriverId,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await post(agentB, `/drivers/${adminDriverId}/password`, {
                password,
              })
            ).body.error.code,
            "DRIVER_ROLE_REQUIRED",
          );
          assert.equal(
            (
              await patch(agentB, `/drivers/${adminDriverId}`, {
                active: false,
              })
            ).body.error.code,
            "DRIVER_ROLE_REQUIRED",
          );
          assert.equal((await agentA.get("/api/auth/me")).status, 200);
        },
      );
      await t.test(
        "ambos cambios de rol conservan camión y perfil; quitarlo no elimina identidad",
        async () => {
          const driver = await patch(agentB, `/users/${a.id}`, {
            role: "DRIVER",
          });
          assert.equal(driver.status, 200);
          assert.equal(driver.body.driverId, adminDriverId);
          assert.equal(driver.body.assignedTruckId, trucks[0]);
          const admin = await patch(agentB, `/users/${a.id}`, {
            role: "ADMIN",
          });
          assert.equal(admin.status, 200);
          assert.equal(admin.body.driverId, adminDriverId);
          assert.equal(admin.body.assignedTruckId, trucks[0]);
          await login(agentA, a.username);
          const cleared = await assign(agentA, a.id, null);
          assert.equal(cleared.status, 200);
          assert.equal(cleared.body.driverId, adminDriverId);
          assert.equal(cleared.body.assignedTruckId, null);
          assert.equal((await assign(agentA, a.id, null)).status, 200);
          assert.equal(
            await db.audit.count({
              where: {
                entity: "USER",
                entityId: a.id,
                action: "TRUCK_UNASSIGNED",
              },
            }),
            1,
          );
          assert.equal((await agentA.get("/api/auth/me")).status, 200);
          assert.equal(
            await db.trip.count({ where: { driverId: adminDriverId } }),
            1,
          );
        },
      );
      await t.test(
        "baja de usuario y camión limpian asignaciones también administrativas, conservando historial",
        async () => {
          assert.equal((await assign(agentA, a.id, trucks[0])).status, 200);
          assert.equal((await remove(agentB, `/users/${a.id}`)).status, 200);
          assert.equal(
            (
              await db.driver.findUniqueOrThrow({
                where: { id: adminDriverId },
              })
            ).assignedTruckId,
            null,
          );
          assert.equal((await agentA.get("/api/auth/me")).status, 401);
          const reactivated = await patch(agentB, `/users/${a.id}`, {
            active: true,
          });
          assert.equal(reactivated.body.assignedTruckId, null);
          assert.equal((await assign(agentB, a.id, trucks[0])).status, 200);
          assert.equal((await assign(agentB, b.id, trucks[0])).status, 200);
          assert.equal((await assign(agentB, d.id, trucks[0])).status, 200);
          assert.equal(
            (await remove(agentB, `/trucks/${trucks[0]}`)).status,
            200,
          );
          assert.equal(
            await db.driver.count({
              where: { userId: { in: users }, assignedTruckId: { not: null } },
            }),
            0,
          );
          assert.equal(
            await db.trip.count({ where: { truckId: trucks[0] } }),
            2,
          );
        },
      );
      await t.test(
        "auditoría registra actor, fecha y valores seguros sin duplicar no-ops",
        async () => {
          const audits = await db.audit.findMany({
            where: {
              entity: "USER",
              entityId: a.id,
              action: { in: ["TRUCK_ASSIGNED", "TRUCK_UNASSIGNED"] },
            },
            orderBy: { createdAt: "asc" },
          });
          assert.equal(audits.length, 4);
          assert.equal(audits[0].actorId, a.id);
          assert.ok(
            audits.every(
              (item) =>
                item.createdAt instanceof Date && users.includes(item.actorId),
            ),
          );
          assert.deepEqual(audits[0].before, {
            driverId: null,
            assignedTruckId: null,
          });
          assert.deepEqual(audits[0].after, {
            driverId: adminDriverId,
            assignedTruckId: trucks[0],
          });
          assert.doesNotMatch(
            JSON.stringify(audits),
            /passwordHash|tokenHash|scrypt\$/,
          );
        },
      );
    } finally {
      await db.audit.deleteMany({ where: { actorId: { in: users } } });
      await db.renewal.deleteMany({
        where: { obligationId: { in: obligations } },
      });
      await db.obligation.deleteMany({ where: { id: { in: obligations } } });
      await db.trip.deleteMany({ where: { truckId: { in: trucks } } });
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.driver.deleteMany({ where: { userId: { in: users } } });
      await db.truck.deleteMany({ where: { id: { in: trucks } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await disconnect();
    }
  },
);

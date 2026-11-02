import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";
import { ODOMETER_ADJUSTED } from "../src/odometer.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "Correcciones de odómetro y baja de camión conservan historial y permisos",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["localhost", "127.0.0.1"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      suffix = randomUUID().slice(0, 8),
      password = "Una-clave-local-auditada";
    const passwordHash = await hashPassword(password),
      origin = getConfig().origin;
    const admin = await db.user.create({
      data: {
        username: `kmadmin_${suffix}`,
        name: "Administración km",
        passwordHash,
        role: "ADMIN",
        mustChangePassword: false,
      },
    });
    const driver = await db.user.create({
      data: {
        username: `kmchofer_${suffix}`,
        name: "Chofer km",
        passwordHash,
        role: "DRIVER",
        mustChangePassword: false,
        driver: { create: {} },
      },
      include: { driver: true },
    });
    const baseline = Date.now() - 10 * 86_400_000;
    const date = (days: number) =>
      new Date(baseline + days * 86_400_000).toISOString();
    const truck = await db.truck.create({
      data: {
        plate: `KM${suffix.toUpperCase()}`,
        label: "Prueba odómetro",
        initialOdometer: 1000,
        initialOdometerAt: new Date(baseline),
      },
    });
    await db.driver.update({
      where: { id: driver.driver!.id },
      data: { assignedTruckId: truck.id },
    });
    const adminAgent = request.agent(app),
      driverAgent = request.agent(app);
    const post = (agent: typeof adminAgent, path: string, data: object) =>
      agent
        .post(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(data);
    const patch = (agent: typeof adminAgent, path: string, data: object) =>
      agent
        .patch(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(data);
    const remove = (agent: typeof adminAgent, path: string) =>
      agent
        .delete(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1");
    const getTruck = async () =>
      (await adminAgent.get("/api/trucks")).body.items.find(
        (row: { id: string }) => row.id === truck.id,
      );
    const adjustment = (
      current: { odometer: number; odometerAt: string },
      odometer: number,
    ) => ({
      odometer,
      expectedOdometer: current.odometer,
      expectedOdometerAt: current.odometerAt,
    });
    const trip = (
      departureAt: string,
      arrivalAt: string,
      startKm: number,
      endKm: number,
    ) => ({
      clientRequestId: randomUUID(),
      truckId: truck.id,
      origin: "Origen de prueba",
      destination: "Destino de prueba",
      departureAt,
      arrivalAt,
      startKm,
      endKm,
    });
    let originalTripId = "",
      recentTripId = "",
      obligationId = "";
    try {
      assert.equal(
        (
          await post(adminAgent, "/auth/login", {
            username: admin.username,
            password,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await post(driverAgent, "/auth/login", {
            username: driver.username,
            password,
          })
        ).status,
        200,
      );
      const firstTrip = await post(
        driverAgent,
        "/trips",
        trip(date(2), date(2.1), 1000, 1200),
      );
      assert.equal(firstTrip.status, 201, JSON.stringify(firstTrip.body));
      originalTripId = firstTrip.body.id;
      const obligation = await post(adminAgent, "/obligations", {
        title: "Service de prueba km",
        kind: "SERVICE",
        truckId: truck.id,
        dueKm: 1500,
        warningKm: 100,
        intervalKm: 1000,
      });
      assert.equal(obligation.status, 201);
      obligationId = obligation.body.id;

      await t.test(
        "Solo administración ajusta y da de baja; valores y campos de auditoría se validan",
        async () => {
          const current = await getTruck();
          assert.equal(
            (
              await patch(
                driverAgent,
                `/trucks/${truck.id}/odometer`,
                adjustment(current, 500),
              )
            ).status,
            403,
          );
          assert.equal(
            (await remove(driverAgent, `/trucks/${truck.id}`)).status,
            403,
          );
          assert.equal(
            (
              await adminAgent
                .patch(`/api/trucks/${truck.id}/odometer`)
                .send(adjustment(current, 500))
            ).status,
            403,
          );
          for (const odometer of [-1, 2.5, 10_000_000])
            assert.equal(
              (
                await patch(
                  adminAgent,
                  `/trucks/${truck.id}/odometer`,
                  adjustment(current, odometer),
                )
              ).status,
              400,
            );
          assert.equal(
            (
              await patch(adminAgent, `/trucks/${truck.id}/odometer`, {
                ...adjustment(current, 500),
                actorId: driver.id,
              })
            ).status,
            400,
          );
          assert.equal(
            await db.audit.count({
              where: { entityId: truck.id, action: ODOMETER_ADJUSTED },
            }),
            0,
          );
        },
      );

      await t.test(
        "Bajar lectura registra actor/fecha/antes/después automáticamente y mantiene viajes",
        async () => {
          const current = await getTruck(),
            started = Date.now();
          const response = await patch(
            adminAgent,
            `/trucks/${truck.id}/odometer`,
            adjustment(current, 500),
          );
          assert.equal(response.status, 200, JSON.stringify(response.body));
          assert.equal(response.body.odometer, 500);
          assert.equal(response.body.initialOdometer, 1000);
          const event = await db.audit.findFirstOrThrow({
            where: { entityId: truck.id, action: ODOMETER_ADJUSTED },
          });
          assert.equal(event.actorId, admin.id);
          assert.ok(
            event.createdAt.getTime() >= started &&
              event.createdAt.getTime() <= Date.now(),
          );
          assert.deepEqual(event.before, {
            version: 1,
            odometer: 1200,
            odometerAt: date(2.1),
          });
          assert.deepEqual(event.after, {
            version: 1,
            odometer: 500,
            odometerAt: event.createdAt.toISOString(),
          });
          assert.equal(
            (await db.trip.findUniqueOrThrow({ where: { id: originalTripId } }))
              .endKm,
            1200,
          );
          assert.equal(
            (
              await patch(
                adminAgent,
                `/trucks/${truck.id}/odometer`,
                adjustment(current, 400),
              )
            ).status,
            409,
          );
          assert.equal(
            await db.audit.count({
              where: { entityId: truck.id, action: ODOMETER_ADJUSTED },
            }),
            1,
          );
        },
      );

      await t.test(
        "Viajes atrasados conservan el ajuste y los nuevos usan el nuevo tramo",
        async () => {
          const current = await getTruck();
          const late = await post(
            driverAgent,
            "/trips",
            trip(date(1), date(1.1), 1000, 1000),
          );
          assert.equal(late.status, 201, JSON.stringify(late.body));
          assert.equal((await getTruck()).odometer, 500);
          const cut = Date.parse(current.odometerAt);
          const boundary = await post(
            driverAgent,
            "/trips",
            trip(
              new Date(cut - 1000).toISOString(),
              new Date(cut).toISOString(),
              1200,
              1250,
            ),
          );
          assert.equal(boundary.status, 409);
          assert.equal(
            boundary.body.error.code,
            "ODOMETER_ADJUSTMENT_BOUNDARY",
          );
          const recent = await post(
            driverAgent,
            "/trips",
            trip(
              new Date(cut + 1).toISOString(),
              new Date(cut + 2).toISOString(),
              500,
              600,
            ),
          );
          assert.equal(recent.status, 201, JSON.stringify(recent.body));
          recentTripId = recent.body.id;
          assert.equal((await getTruck()).odometer, 600);
          const cancelled = await post(
            adminAgent,
            `/trips/${recentTripId}/cancel`,
            { version: recent.body.version, reason: "Prueba de recálculo" },
          );
          assert.equal(cancelled.status, 200);
          assert.equal((await getTruck()).odometer, 500);
          const oldCorrection = await patch(
            adminAgent,
            `/trips/${originalTripId}`,
            { version: 1, endKm: 1100 },
          );
          assert.equal(
            oldCorrection.status,
            200,
            JSON.stringify(oldCorrection.body),
          );
          assert.equal((await getTruck()).odometer, 500);
        },
      );

      await t.test(
        "Servicios históricos y posteriores respetan sus tramos de kilometraje",
        async () => {
          const current = await getTruck();
          const historical = await post(adminAgent, "/obligations", {
            title: "Service histórico",
            kind: "SERVICE",
            truckId: truck.id,
            initialRecord: { performedAt: date(3), odometer: 1300 },
          });
          assert.equal(historical.status, 201, JSON.stringify(historical.body));
          assert.equal((await getTruck()).odometer, 500);
          const recent = await post(adminAgent, "/obligations", {
            title: "Service posterior al ajuste",
            kind: "SERVICE",
            truckId: truck.id,
            initialRecord: {
              performedAt: new Date(
                Date.parse(current.odometerAt) + 1,
              ).toISOString(),
              odometer: 600,
            },
          });
          assert.equal(recent.status, 201, JSON.stringify(recent.body));
          assert.equal((await getTruck()).odometer, 600);
        },
      );

      await t.test(
        "Correcciones concurrentes no se pisan y los límites de servicio se recalculan",
        async () => {
          const current = await getTruck();
          const responses = await Promise.all([
            patch(
              adminAgent,
              `/trucks/${truck.id}/odometer`,
              adjustment(current, 1600),
            ),
            patch(
              adminAgent,
              `/trucks/${truck.id}/odometer`,
              adjustment(current, 1700),
            ),
          ]);
          assert.deepEqual(
            responses.map((row) => row.status).sort(),
            [200, 409],
          );
          assert.equal(
            await db.audit.count({
              where: { entityId: truck.id, action: ODOMETER_ADJUSTED },
            }),
            2,
          );
          let control = (
            await adminAgent.get("/api/obligations")
          ).body.items.find((row: { id: string }) => row.id === obligationId);
          assert.equal(control.status, "OVERDUE");
          assert.equal(control.dueKm, 1500);
          const lowered = await patch(
            adminAgent,
            `/trucks/${truck.id}/odometer`,
            adjustment(await getTruck(), 400),
          );
          assert.equal(lowered.status, 200, JSON.stringify(lowered.body));
          control = (await adminAgent.get("/api/obligations")).body.items.find(
            (row: { id: string }) => row.id === obligationId,
          );
          assert.equal(control.status, "OK");
          assert.equal(control.kmRemaining, 1100);
        },
      );

      await t.test(
        "Baja idempotente desasigna chofer, conserva registros y admite reactivación",
        async () => {
          const tripCount = await db.trip.count({
            where: { truckId: truck.id },
          });
          const deleted = await remove(adminAgent, `/trucks/${truck.id}`);
          assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
          assert.equal(deleted.body.active, false);
          assert.equal(
            (
              await db.driver.findUniqueOrThrow({
                where: { id: driver.driver!.id },
              })
            ).assignedTruckId,
            null,
          );
          assert.equal(
            await db.trip.count({ where: { truckId: truck.id } }),
            tripCount,
          );
          assert.ok(
            await db.obligation.findUnique({ where: { id: obligationId } }),
          );
          assert.equal(
            (await remove(adminAgent, `/trucks/${truck.id}`)).status,
            200,
          );
          assert.equal(
            await db.audit.count({
              where: { entityId: truck.id, action: "DEACTIVATED" },
            }),
            1,
          );
          assert.equal(
            await db.audit.count({
              where: {
                entityId: driver.driver!.id,
                action: "TRUCK_UNASSIGNED",
                actorId: admin.id,
              },
            }),
            1,
          );
          assert.equal(
            (
              await patch(
                adminAgent,
                `/trucks/${truck.id}/odometer`,
                adjustment(await getTruck(), 450),
              )
            ).status,
            409,
          );
          assert.equal(
            (
              await post(
                driverAgent,
                "/trips",
                trip(date(0.5), date(0.6), 1000, 1000),
              )
            ).status,
            400,
          );
          const reactivated = await patch(adminAgent, `/trucks/${truck.id}`, {
            active: true,
          });
          assert.equal(reactivated.status, 200);
          assert.equal(reactivated.body.odometer, 400);
          assert.equal(
            (
              await db.driver.findUniqueOrThrow({
                where: { id: driver.driver!.id },
              })
            ).assignedTruckId,
            null,
          );
        },
      );
    } finally {
      await db.audit.deleteMany({
        where: { actorId: { in: [admin.id, driver.id] } },
      });
      await db.trip.deleteMany({ where: { truckId: truck.id } });
      await db.renewal.deleteMany({
        where: { obligation: { truckId: truck.id } },
      });
      await db.obligation.deleteMany({ where: { truckId: truck.id } });
      await db.driver.deleteMany({ where: { userId: driver.id } });
      await db.truck.delete({ where: { id: truck.id } });
      await db.user.deleteMany({
        where: { id: { in: [admin.id, driver.id] } },
      });
      await disconnect();
    }
  },
);

import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { unzipSync, strFromU8 } from "fflate";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";
import { businessDay, calculateStatus } from "../src/domain.js";
import { runNotificationJob } from "../src/notifications.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";

test("un límite de km desconocido nunca afirma que está al día", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  const obligation = {
    dueDate: new Date("2027-02-01"),
    dueKm: 5000,
    warningDays: 10,
    warningKm: 100,
  };
  assert.equal(calculateStatus(obligation, null, now).status, "UNCONFIGURED");
  assert.equal(
    calculateStatus({ ...obligation, dueDate: null }, null, now).status,
    "UNCONFIGURED",
  );
  assert.equal(
    calculateStatus(
      { ...obligation, dueDate: new Date("2026-11-04") },
      null,
      now,
    ).status,
    "OVERDUE",
  );
  assert.equal(
    calculateStatus(
      { ...obligation, dueDate: new Date("2026-11-08") },
      null,
      now,
    ).status,
    "UPCOMING",
  );
  assert.equal(
    calculateStatus({ ...obligation, dueKm: null }, null, now).status,
    "OK",
  );
  assert.equal(calculateStatus(obligation, 0, now).status, "OK");
});

test(
  "flota con acoplados y camiones sin lectura en PostgreSQL aislado",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      suffix = randomUUID().slice(0, 8);
    const password = "Clave-ficticia-flota-2026";
    const passwordHash = await hashPassword(password);
    const origin = getConfig().origin;
    const users: string[] = [],
      trucks: string[] = [],
      trailers: string[] = [];
    const recipient = `fleet-${suffix}@example.invalid`;
    const oldSettings = await db.setting.findUniqueOrThrow({
      where: { id: "main" },
    });
    const baseline = Date.now() - 10 * 86_400_000;
    const at = (hours: number) =>
      new Date(baseline + hours * 3_600_000).toISOString();
    let nextPlate = 0;
    const plate = () => `F${suffix}${++nextPlate}`.toUpperCase();
    const adminAgent = request.agent(app),
      driverAgent = request.agent(app),
      otherAgent = request.agent(app);
    type Agent = typeof adminAgent;
    const post = (agent: Agent, path: string, body: object) =>
      agent
        .post(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const patch = (agent: Agent, path: string, body: object) =>
      agent
        .patch(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const remove = (agent: Agent, path: string) =>
      agent
        .delete(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1");
    const createTruck = async (extra: object = {}) => {
      const res = await post(adminAgent, "/trucks", {
        plate: plate(),
        label: "Camión ficticio",
        ...extra,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      trucks.push(res.body.id);
      return res.body;
    };
    const createTrailer = async (extra: object = {}) => {
      const res = await post(adminAgent, "/trailers", {
        plate: plate(),
        label: "Acoplado ficticio",
        ...extra,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      trailers.push(res.body.id);
      return res.body;
    };
    const getTruck = async (id: string) =>
      (await adminAgent.get("/api/trucks")).body.items.find(
        (row: { id: string }) => row.id === id,
      );
    const getTrailer = async (id: string) =>
      (await adminAgent.get("/api/trailers")).body.items.find(
        (row: { id: string }) => row.id === id,
      );
    const trip = (truckId: string, hour: number, extra: object = {}) => ({
      clientRequestId: randomUUID(),
      truckId,
      origin: "Origen ficticio",
      destination: "Destino ficticio",
      departureAt: at(hour),
      arrivalAt: at(hour + 1),
      startKm: hour * 100,
      endKm: hour * 100 + 50,
      ...extra,
    });
    try {
      const admin = await db.user.create({
        data: {
          username: `fleet_admin_${suffix}`,
          name: "Admin ficticio",
          passwordHash,
          role: "ADMIN",
          mustChangePassword: false,
        },
      });
      users.push(admin.id);
      const driver = await db.user.create({
        data: {
          username: `fleet_driver_${suffix}`,
          name: "Chofer ficticio",
          passwordHash,
          role: "DRIVER",
          mustChangePassword: false,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      users.push(driver.id);
      const other = await db.user.create({
        data: {
          username: `fleet_other_${suffix}`,
          name: "Otro chofer ficticio",
          passwordHash,
          role: "DRIVER",
          mustChangePassword: false,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      users.push(other.id);
      for (const [agent, user] of [
        [adminAgent, admin],
        [driverAgent, driver],
        [otherAgent, other],
      ] as const)
        assert.equal(
          (
            await post(agent, "/auth/login", {
              username: user.username,
              password,
            })
          ).status,
          200,
        );

      await t.test(
        "alta sin lectura, cero válido, parejas completas y primera carga concurrente",
        async () => {
          const unknown = await createTruck();
          assert.equal(unknown.initialOdometer, null);
          assert.equal(unknown.initialOdometerAt, null);
          assert.equal(unknown.odometer, null);
          assert.equal(unknown.odometerAt, null);
          const zero = await createTruck({
            initialOdometer: 0,
            initialOdometerAt: at(0),
          });
          assert.equal(zero.odometer, 0);
          for (const fields of [
            { initialOdometer: 20 },
            { initialOdometerAt: at(0) },
            { initialOdometer: -1, initialOdometerAt: at(0) },
            { initialOdometer: 2.5, initialOdometerAt: at(0) },
            {
              initialOdometer: 1,
              initialOdometerAt: new Date(Date.now() + 3_600_000).toISOString(),
            },
          ])
            assert.equal(
              (
                await post(adminAgent, "/trucks", {
                  plate: plate(),
                  label: "Inválido",
                  ...fields,
                })
              ).status,
              400,
            );
          const reading = {
            expectedOdometer: null,
            expectedOdometerAt: null,
            odometer: 12000,
          };
          assert.equal(
            (
              await patch(
                driverAgent,
                `/trucks/${unknown.id}/odometer`,
                reading,
              )
            ).status,
            403,
          );
          const started = Date.now();
          const results = await Promise.all([
            patch(adminAgent, `/trucks/${unknown.id}/odometer`, reading),
            patch(adminAgent, `/trucks/${unknown.id}/odometer`, {
              ...reading,
              odometer: 12500,
            }),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
          const current = await getTruck(unknown.id);
          assert.ok([12000, 12500].includes(current.odometer));
          assert.equal(current.initialOdometer, current.odometer);
          assert.equal(current.initialOdometerAt, current.odometerAt);
          assert.ok(Date.parse(current.odometerAt) >= started);
          assert.equal(
            await db.audit.count({
              where: {
                entityId: unknown.id,
                action: "ODOMETER_INITIALIZED",
                actorId: admin.id,
              },
            }),
            1,
          );
          assert.equal(
            (await patch(adminAgent, `/trucks/${unknown.id}/odometer`, reading))
              .body.error.code,
            "ODOMETER_VERSION_CONFLICT",
          );
          await assert.rejects(
            db.truck.create({
              data: {
                plate: plate(),
                label: "Pareja SQL inválida",
                initialOdometer: 1,
              },
            }),
          );
        },
      );

      await t.test(
        "primer viaje o service aportan lectura sin inventar inicial; anular recupera desconocido",
        async () => {
          const truck = await createTruck();
          const body = trip(truck.id, 10);
          const created = await post(driverAgent, "/trips", body);
          assert.equal(created.status, 201, JSON.stringify(created.body));
          let current = await getTruck(truck.id);
          assert.equal(current.odometer, body.endKm);
          assert.equal(current.initialOdometer, null);
          const stale = await patch(
            adminAgent,
            `/trucks/${truck.id}/odometer`,
            {
              odometer: 1100,
              expectedOdometer: null,
              expectedOdometerAt: null,
            },
          );
          assert.equal(stale.status, 409);
          assert.equal(
            (
              await post(adminAgent, `/trips/${created.body.id}/cancel`, {
                version: created.body.version,
                reason: "Anulación ficticia",
              })
            ).status,
            200,
          );
          current = await getTruck(truck.id);
          assert.equal(current.odometer, null);
          assert.equal(current.odometerAt, null);
          const service = await post(adminAgent, "/obligations", {
            title: "Primer service",
            kind: "SERVICE",
            truckId: truck.id,
            dueKm: 2000,
            initialRecord: { performedAt: at(12), odometer: 1200 },
          });
          assert.equal(service.status, 201, JSON.stringify(service.body));
          current = await getTruck(truck.id);
          assert.equal(current.odometer, 1200);
          assert.equal(current.initialOdometer, null);
          const regression = await post(
            driverAgent,
            "/trips",
            trip(truck.id, 13, { startKm: 900, endKm: 1000 }),
          );
          assert.equal(regression.status, 409);
        },
      );

      await t.test(
        "acoplados tienen permisos administrativos, CSRF y patente única en toda la flota",
        async () => {
          const truck = await createTruck();
          assert.equal((await request(app).get("/api/trailers")).status, 401);
          assert.equal(
            (
              await post(driverAgent, "/trailers", {
                plate: plate(),
                label: "No permitido",
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await adminAgent
                .post("/api/trailers")
                .send({ plate: plate(), label: "Sin CSRF" })
            ).status,
            403,
          );
          assert.equal(
            (
              await post(adminAgent, "/trailers", {
                plate: truck.plate.toLowerCase(),
                label: "Duplicado",
              })
            ).status,
            409,
          );
          const trailer = await createTrailer();
          assert.equal(trailer.assignedTruckId, null);
          assert.equal(trailer.odometer, undefined);
          assert.equal(
            (
              await post(adminAgent, "/trucks", {
                plate: trailer.plate,
                label: "Duplicado",
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await patch(adminAgent, `/trucks/${truck.id}`, {
                plate: trailer.plate,
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await patch(adminAgent, `/trailers/${trailer.id}`, {
                version: trailer.version,
                plate: truck.plate,
              })
            ).status,
            409,
          );
          assert.equal(
            (
              await patch(driverAgent, `/trailers/${trailer.id}`, {
                version: trailer.version,
                label: "No",
              })
            ).status,
            403,
          );
          assert.equal(
            (await remove(driverAgent, `/trailers/${trailer.id}`)).status,
            403,
          );
          assert.equal(
            (await driverAgent.get(`/api/trailers/${trailer.id}/history`))
              .status,
            403,
          );
          assert.equal(
            (
              await post(adminAgent, "/trailers", {
                plate: plate(),
                label: "No km",
                odometer: 100,
              })
            ).status,
            400,
          );
          const edited = await patch(adminAgent, `/trailers/${trailer.id}`, {
            version: trailer.version,
            label: "Descripción corregida",
          });
          assert.equal(edited.status, 200, JSON.stringify(edited.body));
          assert.equal(
            (
              await patch(adminAgent, `/trailers/${trailer.id}`, {
                version: trailer.version,
                label: "Edición vieja",
              })
            ).status,
            409,
          );
          const sharedPlate = plate();
          const duplicateRace = await Promise.all([
            post(adminAgent, "/trucks", {
              plate: sharedPlate,
              label: "Camión concurrente",
            }),
            post(adminAgent, "/trailers", {
              plate: sharedPlate,
              label: "Acoplado concurrente",
            }),
          ]);
          for (const [i, result] of duplicateRace.entries())
            if (result.status === 201)
              (i === 0 ? trucks : trailers).push(result.body.id);
          assert.deepEqual(
            duplicateRace.map((r) => r.status).sort(),
            [201, 409],
          );
        },
      );

      await t.test(
        "una asignación por camión, conflictos concurrentes y bajas sin restauración",
        async () => {
          const a = await createTruck(),
            b = await createTruck();
          const x = await createTrailer(),
            y = await createTrailer();
          const assigned = await patch(adminAgent, `/trailers/${x.id}/truck`, {
            version: x.version,
            assignedTruckId: a.id,
          });
          assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
          const auditCount = await db.audit.count({
            where: { entityId: x.id },
          });
          const repeated = await patch(adminAgent, `/trailers/${x.id}/truck`, {
            version: assigned.body.version,
            assignedTruckId: a.id,
          });
          assert.equal(repeated.status, 200);
          assert.equal(
            await db.audit.count({ where: { entityId: x.id } }),
            auditCount,
          );
          const occupied = await patch(adminAgent, `/trailers/${y.id}/truck`, {
            version: y.version,
            assignedTruckId: a.id,
          });
          assert.equal(occupied.status, 409);
          assert.equal(occupied.body.error.code, "TRAILER_ASSIGNMENT_CONFLICT");
          assert.equal((await getTrailer(x.id)).assignedTruckId, a.id);
          const race = await Promise.all([
            patch(adminAgent, `/trailers/${x.id}/truck`, {
              version: assigned.body.version,
              assignedTruckId: b.id,
            }),
            patch(adminAgent, `/trailers/${y.id}/truck`, {
              version: y.version,
              assignedTruckId: b.id,
            }),
          ]);
          assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
          assert.equal(
            await db.trailer.count({ where: { assignedTruckId: b.id } }),
            1,
          );
          const winner = (
            await db.trailer.findFirstOrThrow({
              where: { assignedTruckId: b.id },
            })
          ).id;
          assert.equal(
            (await remove(adminAgent, `/trucks/${b.id}`)).status,
            200,
          );
          const freed = await getTrailer(winner);
          assert.equal(freed.assignedTruckId, null);
          assert.equal(
            (
              await patch(adminAgent, `/trailers/${winner}/truck`, {
                version: freed.version,
                assignedTruckId: b.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (await patch(adminAgent, `/trucks/${b.id}`, { active: true }))
              .status,
            200,
          );
          assert.equal((await getTrailer(winner)).assignedTruckId, null);
          const reassigned = await patch(
            adminAgent,
            `/trailers/${winner}/truck`,
            { version: freed.version, assignedTruckId: b.id },
          );
          assert.equal(reassigned.status, 200);
          const removed = await remove(adminAgent, `/trailers/${winner}`);
          assert.equal(removed.status, 200);
          assert.equal(removed.body.active, false);
          assert.equal(removed.body.assignedTruckId, null);
          assert.equal(
            (await remove(adminAgent, `/trailers/${winner}`)).status,
            200,
          );
          assert.equal(
            await db.audit.count({
              where: { entityId: winner, action: "DEACTIVATED" },
            }),
            1,
          );
          const revived = await patch(adminAgent, `/trailers/${winner}`, {
            version: removed.body.version,
            active: true,
          });
          assert.equal(revived.status, 200);
          assert.equal(revived.body.assignedTruckId, null);
          const history = await adminAgent.get(
            `/api/trailers/${winner}/history`,
          );
          assert.equal(history.status, 200);
          assert.ok(
            history.body.items.some(
              (event: { action: string }) =>
                event.action === "TRUCK_UNASSIGNED",
            ),
          );
          assert.ok(
            history.body.items.some(
              (event: { action: string }) => event.action === "DEACTIVATED",
            ),
          );
          assert.doesNotMatch(
            JSON.stringify(history.body),
            /passwordHash|tokenHash|scrypt\$/,
          );
        },
      );

      await t.test(
        "documentos y servicios del acoplado por fecha conservan historia y propiedad",
        async () => {
          const a = await createTruck(),
            b = await createTruck();
          await db.driver.update({
            where: { id: driver.driver!.id },
            data: { assignedTruckId: a.id },
          });
          await db.driver.update({
            where: { id: other.driver!.id },
            data: { assignedTruckId: b.id },
          });
          const trailer = await createTrailer({ assignedTruckId: a.id });
          const dueDate = businessDay(new Date());
          const service = await post(adminAgent, "/obligations", {
            title: "Service acoplado",
            kind: "SERVICE",
            trailerId: trailer.id,
            dueDate,
            intervalMonths: 6,
            initialRecord: { performedAt: at(20), notes: "Hecho sin odómetro" },
          });
          assert.equal(service.status, 201, JSON.stringify(service.body));
          const document = await post(adminAgent, "/obligations", {
            title: "Documento acoplado",
            kind: "DOCUMENT",
            trailerId: trailer.id,
            dueDate,
          });
          assert.equal(document.status, 201, JSON.stringify(document.body));
          for (const extra of [
            { dueKm: 1000 },
            { intervalKm: 1000 },
            { truckId: a.id },
            { initialRecord: { performedAt: at(20), odometer: 1000 } },
          ])
            assert.equal(
              (
                await post(adminAgent, "/obligations", {
                  title: "No permitido",
                  kind: "SERVICE",
                  trailerId: trailer.id,
                  dueDate,
                  ...extra,
                })
              ).status,
              400,
            );
          assert.equal(
            (
              await driverAgent.get(
                `/api/obligations/${service.body.id}/renewals`,
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await otherAgent.get(
                `/api/obligations/${service.body.id}/renewals`,
              )
            ).status,
            404,
          );
          const reassigned = await patch(
            adminAgent,
            `/trailers/${trailer.id}/truck`,
            { version: trailer.version, assignedTruckId: b.id },
          );
          assert.equal(reassigned.status, 200);
          assert.equal(
            (
              await driverAgent.get(
                `/api/obligations/${service.body.id}/renewals`,
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await otherAgent.get(
                `/api/obligations/${service.body.id}/renewals`,
              )
            ).status,
            200,
          );
          assert.equal(
            (await driverAgent.get("/api/obligations")).body.items.some(
              (o: { id: string }) => o.id === service.body.id,
            ),
            false,
          );
          assert.equal(
            (await otherAgent.get("/api/obligations")).body.items.some(
              (o: { id: string }) => o.id === service.body.id,
            ),
            true,
          );
          for (const extra of [{ odometer: 20 }, { nextDueKm: 2000 }])
            assert.equal(
              (
                await post(
                  adminAgent,
                  `/obligations/${service.body.id}/renewals`,
                  {
                    version: service.body.version,
                    performedAt: at(21),
                    ...extra,
                  },
                )
              ).status,
              400,
            );
          const renewal = await post(
            adminAgent,
            `/obligations/${service.body.id}/renewals`,
            {
              version: service.body.version,
              performedAt: at(21),
              nextDueDate: "2027-01-01",
            },
          );
          assert.equal(renewal.status, 201, JSON.stringify(renewal.body));
          const differentOwner = await createTrailer();
          const moveWithHistory = await patch(
            adminAgent,
            `/obligations/${service.body.id}`,
            {
              version: renewal.body.version,
              trailerId: differentOwner.id,
            },
          );
          assert.equal(moveWithHistory.status, 409);
          assert.match(
            moveWithHistory.body.error.message,
            /historial registrado/,
          );
          assert.equal(
            (
              await patch(adminAgent, `/trailers/${trailer.id}/truck`, {
                version: reassigned.body.version,
                assignedTruckId: null,
              })
            ).status,
            200,
          );
          let item = (await adminAgent.get("/api/obligations")).body.items.find(
            (o: { id: string }) => o.id === document.body.id,
          );
          assert.equal(item.ownerActive, true);
          assert.equal(item.trailerId, trailer.id);
          assert.equal(item.status, "OVERDUE");
          assert.ok(
            (await adminAgent.get("/api/dashboard")).body.obligations.some(
              (o: { id: string }) => o.id === document.body.id,
            ),
          );
          assert.equal(
            (
              await otherAgent.get(
                `/api/obligations/${service.body.id}/renewals`,
              )
            ).status,
            404,
          );
          assert.equal(
            (await remove(adminAgent, `/trailers/${trailer.id}`)).status,
            200,
          );
          item = (await adminAgent.get("/api/obligations")).body.items.find(
            (o: { id: string }) => o.id === document.body.id,
          );
          assert.equal(item.ownerActive, false);
          const inactiveRenewal = await post(
            adminAgent,
            `/obligations/${document.body.id}/renewals`,
            {
              version: document.body.version,
              performedAt: at(22),
              nextDueDate: "2027-01-01",
            },
          );
          // Like trucks and drivers, an inactive owner is an invalid renewal target.
          assert.equal(inactiveRenewal.status, 400);
          assert.match(inactiveRenewal.body.error.message, /acoplado activo/);
          assert.equal(
            await db.renewal.count({
              where: { obligationId: service.body.id },
            }),
            2,
          );
        },
      );

      await t.test(
        "el acoplado del viaje es histórico, admite edición y respeta revisiones",
        async () => {
          const a = await createTruck(),
            b = await createTruck();
          const trailer = await createTrailer({ assignedTruckId: b.id });
          const body = trip(a.id, 40, {
            trailerId: trailer.id,
            allowance: "1234.50",
          });
          const created = await post(driverAgent, "/trips", body);
          assert.equal(created.status, 201, JSON.stringify(created.body));
          assert.equal(created.body.trailer.id, trailer.id);
          assert.equal((await getTrailer(trailer.id)).assignedTruckId, b.id);
          const moved = await patch(
            adminAgent,
            `/trailers/${trailer.id}/truck`,
            { version: trailer.version, assignedTruckId: a.id },
          );
          assert.equal(moved.status, 200);
          assert.equal(
            (await driverAgent.get(`/api/trips/${created.body.id}`)).body
              .trailerId,
            trailer.id,
          );
          assert.equal(
            (await otherAgent.get(`/api/trips/${created.body.id}`)).status,
            404,
          );
          const replay = await post(driverAgent, "/trips", body);
          assert.equal(replay.status, 200);
          assert.equal(replay.body.id, created.body.id);
          const different = await createTrailer();
          assert.equal(
            (
              await post(driverAgent, "/trips", {
                ...body,
                trailerId: different.id,
              })
            ).body.error.code,
            "IDEMPOTENCY_CONFLICT",
          );
          const deleted = await remove(adminAgent, `/trailers/${trailer.id}`);
          assert.equal(deleted.status, 200);
          assert.equal((await post(driverAgent, "/trips", body)).status, 200);
          const retained = await patch(
            driverAgent,
            `/trips/${created.body.id}`,
            {
              version: created.body.version,
              notes: "Conserva acoplado inactivo",
            },
          );
          assert.equal(retained.status, 200, JSON.stringify(retained.body));
          assert.equal(retained.body.trailerId, trailer.id);
          const cleared = await patch(
            driverAgent,
            `/trips/${created.body.id}`,
            { version: retained.body.version, trailerId: null },
          );
          assert.equal(cleared.status, 200);
          assert.equal(cleared.body.trailerId, null);
          assert.equal(
            (
              await patch(driverAgent, `/trips/${created.body.id}`, {
                version: cleared.body.version,
                trailerId: trailer.id,
              })
            ).status,
            400,
          );
          const changed = await patch(
            driverAgent,
            `/trips/${created.body.id}`,
            { version: cleared.body.version, trailerId: different.id },
          );
          assert.equal(changed.status, 200);
          const review = await post(
            adminAgent,
            `/trips/${created.body.id}/review`,
            { version: changed.body.version },
          );
          assert.equal(review.status, 200);
          assert.equal(
            (
              await patch(driverAgent, `/trips/${created.body.id}`, {
                version: review.body.version,
                trailerId: null,
              })
            ).status,
            403,
          );
          const correction = await patch(
            adminAgent,
            `/trips/${created.body.id}`,
            {
              version: review.body.version,
              notes: "Corrección administrativa",
            },
          );
          assert.equal(correction.status, 200);
          assert.equal(correction.body.reviewedAt, null);
          const history = await driverAgent.get(
            `/api/trips/${created.body.id}/history`,
          );
          assert.equal(history.status, 200);
          assert.match(JSON.stringify(history.body), new RegExp(different.id));
          const filtered = await adminAgent.get(
            `/api/trips?trailerId=${different.id}`,
          );
          assert.equal(filtered.status, 200);
          assert.ok(
            filtered.body.items.some(
              (row: { id: string }) => row.id === created.body.id,
            ),
          );
          const exported = await adminAgent
            .get(`/api/trips/export?format=detail&truckId=${a.id}`)
            .buffer(true)
            .parse((res, callback) => {
              const chunks: Buffer[] = [];
              res.on("data", (chunk: Buffer) => chunks.push(chunk));
              res.on("end", () => callback(null, Buffer.concat(chunks)));
            });
          assert.equal(exported.status, 200);
          const files = unzipSync(exported.body);
          const xml = Object.entries(files)
            .filter(([name]) => name.endsWith(".xml"))
            .map(([, data]) => strFromU8(data))
            .join("\n");
          assert.match(xml, /Acoplado/);
          assert.match(xml, new RegExp(different.plate));
          assert.match(xml, /1234\.5/);
        },
      );

      await t.test(
        "acoplado no puede compartir horarios entre camiones, incluso concurrentemente",
        async () => {
          const a = await createTruck(),
            b = await createTruck();
          const trailer = await createTrailer();
          const firstBody = trip(a.id, 60, { trailerId: trailer.id });
          const secondBody = trip(b.id, 60, { trailerId: trailer.id });
          const responses = await Promise.all([
            post(driverAgent, "/trips", firstBody),
            post(otherAgent, "/trips", secondBody),
          ]);
          assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
          const winner = responses.find((r) => r.status === 201)!;
          assert.equal(
            await db.trip.count({ where: { trailerId: trailer.id } }),
            1,
          );
          const losingAgent =
            responses[0].status === 201 ? otherAgent : driverAgent;
          const losingTruck = responses[0].status === 201 ? b : a;
          const adjacent = await post(
            losingAgent,
            "/trips",
            trip(losingTruck.id, 61, { trailerId: trailer.id }),
          );
          assert.equal(adjacent.status, 201, JSON.stringify(adjacent.body));
          const overlappingEdit = await patch(
            losingAgent,
            `/trips/${adjacent.body.id}`,
            { version: adjacent.body.version, departureAt: at(60.5) },
          );
          assert.equal(overlappingEdit.status, 409);
          const canceled = await post(
            adminAgent,
            `/trips/${winner.body.id}/cancel`,
            {
              version: winner.body.version,
              reason: "Libera horario de prueba",
            },
          );
          assert.equal(canceled.status, 200);
          const allowed = await patch(
            losingAgent,
            `/trips/${adjacent.body.id}`,
            { version: adjacent.body.version, departureAt: at(60.5) },
          );
          assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
        },
      );

      await t.test(
        "reenvío previo a la función conserva hash y omitir acoplado nunca infiere asignación",
        async () => {
          const truck = await createTruck();
          const trailer = await createTrailer({ assignedTruckId: truck.id });
          const input = trip(truck.id, 80);
          const fields = {
            driverId: driver.driver!.id,
            truckId: truck.id,
            origin: input.origin,
            destination: input.destination,
            departureAt: input.departureAt,
            arrivalAt: input.arrivalAt,
            startKm: input.startKm,
            endKm: input.endKm,
            allowance: null,
            notes: null,
          };
          const legacy = await db.trip.create({
            data: {
              ...fields,
              departureAt: new Date(fields.departureAt),
              arrivalAt: new Date(fields.arrivalAt),
              clientRequestId: input.clientRequestId,
              createdById: driver.id,
              requestHash: createHash("sha256")
                .update(JSON.stringify(fields))
                .digest("hex"),
            },
          });
          for (const body of [input, { ...input, trailerId: null }]) {
            const replay = await post(driverAgent, "/trips", body);
            assert.equal(replay.status, 200, JSON.stringify(replay.body));
            assert.equal(replay.body.id, legacy.id);
            assert.equal(replay.body.trailerId, null);
          }
          const created = await post(driverAgent, "/trips", trip(truck.id, 82));
          assert.equal(created.status, 201);
          assert.equal(created.body.trailerId, null);
          assert.equal(
            (await getTrailer(trailer.id)).assignedTruckId,
            truck.id,
          );
        },
      );

      await t.test(
        "alertas por fecha funcionan sin km y acoplados sin camión llegan al correo simulado",
        async () => {
          const truck = await createTruck(),
            trailer = await createTrailer();
          const now = new Date(`${businessDay()}T15:00:00Z`);
          const dueDate = businessDay(now);
          const combined = await post(adminAgent, "/obligations", {
            title: `Fecha y km ${suffix}`,
            kind: "SERVICE",
            truckId: truck.id,
            dueDate,
            dueKm: 2000,
          });
          assert.equal(combined.status, 201);
          assert.equal(combined.body.status, "OVERDUE");
          assert.equal(combined.body.odometerMissing, true);
          assert.equal(combined.body.kmRemaining, null);
          const unknown = await post(adminAgent, "/obligations", {
            title: `Solo km ${suffix}`,
            kind: "SERVICE",
            truckId: truck.id,
            dueKm: 3000,
          });
          assert.equal(unknown.status, 201);
          assert.equal(unknown.body.status, "UNCONFIGURED");
          const trailerDocument = await post(adminAgent, "/obligations", {
            title: `Documento libre ${suffix}`,
            kind: "DOCUMENT",
            trailerId: trailer.id,
            dueDate,
          });
          assert.equal(trailerDocument.status, 201);
          await db.setting.update({
            where: { id: "main" },
            data: { recipientEmail: recipient },
          });
          let message = "";
          const sent = await runNotificationJob({
            now,
            configured: true,
            send: async (mail) => {
              message = String(mail.text);
            },
          });
          assert.equal(sent.sent, 1);
          assert.match(message, new RegExp(trailer.plate));
          assert.match(message, new RegExp(`Fecha y km ${suffix}`));
          assert.match(
            message,
            /[Kk]ilometraje sin informar|[Ff]alta informar.*kilometraje/,
          );
          assert.doesNotMatch(message, new RegExp(`Solo km ${suffix}`));
          assert.doesNotMatch(message, /null km|NaN|Invalid Date/);
        },
      );
    } finally {
      await db.setting.update({
        where: { id: "main" },
        data: {
          recipientEmail: oldSettings.recipientEmail,
          warningDays: oldSettings.warningDays,
          warningKm: oldSettings.warningKm,
        },
      });
      await db.notification.deleteMany({ where: { recipient } });
      await db.audit.deleteMany({ where: { actorId: { in: users } } });
      await db.renewal.deleteMany({ where: { createdById: { in: users } } });
      await db.obligation.deleteMany({
        where: {
          OR: [{ truckId: { in: trucks } }, { trailerId: { in: trailers } }],
        },
      });
      await db.trip.deleteMany({ where: { createdById: { in: users } } });
      await db.session.deleteMany({ where: { userId: { in: users } } });
      await db.driver.deleteMany({ where: { userId: { in: users } } });
      await db.trailer.deleteMany({ where: { id: { in: trailers } } });
      await db.truck.deleteMany({ where: { id: { in: trucks } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await disconnect();
    }
  },
);

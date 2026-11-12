import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { unzipSync, strFromU8 } from "fflate";
import { createApp } from "../src/app.js";
import { getDb, assertDatabaseScope, disconnect } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { runNotificationJob } from "../src/notifications.js";
import { businessDay } from "../src/domain.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "API integral con PostgreSQL exclusivo y SMTP simulado",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(
      target.database,
      "tomasini_test",
      "Las pruebas integrales requieren tomasini_test.",
    );
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      suffix = randomUUID().slice(0, 8),
      password = "Una-clave-test-muy-larga";
    const passwordHash = await hashPassword(password),
      origin = getConfig().origin;
    const admin = await db.user.create({
      data: {
        username: `admin_${suffix}`,
        name: "Admin prueba",
        passwordHash,
        role: "ADMIN",
        mustChangePassword: false,
      },
    });
    const first = await db.user.create({
      data: {
        username: `chofer_${suffix}`,
        name: "Chofer Uno",
        passwordHash,
        role: "DRIVER",
        mustChangePassword: false,
        driver: { create: {} },
      },
      include: { driver: true },
    });
    const other = await db.user.create({
      data: {
        username: `otro_${suffix}`,
        name: "Chofer Dos",
        passwordHash,
        role: "DRIVER",
        mustChangePassword: false,
        driver: { create: {} },
      },
      include: { driver: true },
    });
    const baseline = new Date(Date.now() - 10 * 86_400_000);
    const truck = await db.truck.create({
      data: {
        plate: `T${suffix.toUpperCase()}`,
        label: "Camión de prueba",
        initialOdometer: 1000,
        initialOdometerAt: baseline,
      },
    });
    const secondTruck = await db.truck.create({
      data: {
        plate: `U${suffix.toUpperCase()}`,
        label: "Camión temporal",
        initialOdometer: 5000,
        initialOdometerAt: baseline,
      },
    });
    await db.driver.update({
      where: { id: first.driver!.id },
      data: { assignedTruckId: truck.id },
    });
    const adminAgent = request.agent(app),
      driverAgent = request.agent(app),
      otherAgent = request.agent(app);
    const post = (agent: typeof adminAgent, path: string, body: object) =>
      agent
        .post(`/api${path}`)
        .set("X-Tomasini-Request", "1")
        .set("Origin", origin)
        .send(body);
    const patch = (agent: typeof adminAgent, path: string, body: object) =>
      agent
        .patch(`/api${path}`)
        .set("X-Tomasini-Request", "1")
        .set("Origin", origin)
        .send(body);
    const date = (daysAfterBaseline: number, hours = 0) =>
      new Date(
        baseline.getTime() + daysAfterBaseline * 86_400_000 + hours * 3_600_000,
      ).toISOString();
    let tripId = "",
      version = 1,
      obligationId = "",
      obligationVersion = 1;
    const previousSettings = await db.setting.findUniqueOrThrow({
      where: { id: "main" },
    });
    const createdObligations: string[] = [];
    try {
      await t.test("login, sesión opaca, CSRF y permisos de rol", async () => {
        assert.equal((await request(app).get("/api/dashboard")).status, 401);
        assert.equal(
          (
            await request(app)
              .post("/api/auth/login")
              .send({ username: admin.username, password })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(app)
              .post("/api/auth/login")
              .set("X-Tomasini-Request", "1")
              .set("Origin", "https://evil.example")
              .send({ username: admin.username, password })
          ).status,
          403,
        );
        const login = await post(adminAgent, "/auth/login", {
          username: admin.username,
          password,
        });
        assert.equal(login.status, 200);
        assert.equal(login.body.passwordHash, undefined);
        assert.match(login.headers["set-cookie"][0], /HttpOnly/);
        assert.match(login.headers["set-cookie"][0], /SameSite=Strict/);
        assert.equal(
          (
            await post(driverAgent, "/auth/login", {
              username: first.username,
              password,
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await post(otherAgent, "/auth/login", {
              username: other.username,
              password,
            })
          ).status,
          200,
        );
        assert.equal((await driverAgent.get("/api/settings")).status, 403);
        assert.equal(
          (await driverAgent.get("/api/drivers")).body.items.length,
          1,
        );
        assert.equal((await post(driverAgent, "/trucks", {})).status, 403);
        const session = await db.session.findFirstOrThrow({
          where: { userId: admin.id },
        });
        assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
        assert.equal((await request(app).get("/api/ready")).status, 200);
      });
      const baseTrip = {
        clientRequestId: randomUUID(),
        truckId: truck.id,
        origin: '=HYPERLINK("https://evil.example")',
        destination: "Córdoba",
        departureAt: date(2),
        arrivalAt: date(2, 4),
        startKm: 1100,
        endKm: 1300,
        controlCount: 0,
        allowance: "1250.50",
        notes: "Prueba",
      };
      await t.test(
        "guardado idempotente concurrente, hash de payload y sumas completas",
        async () => {
          for (const controlCount of [-1, 1.5, "2", 2_147_483_648]) {
            const invalid = await post(driverAgent, "/trips", {
              ...baseTrip,
              controlCount,
            });
            assert.equal(invalid.status, 400);
            assert.ok(invalid.body.error.fields.controlCount);
          }
          const [a, b] = await Promise.all([
            post(driverAgent, "/trips", baseTrip),
            post(driverAgent, "/trips", baseTrip),
          ]);
          assert.ok([200, 201].includes(a.status), JSON.stringify(a.body));
          assert.ok([200, 201].includes(b.status), JSON.stringify(b.body));
          assert.equal(a.body.id, b.body.id);
          assert.equal(a.body.controlCount, 0);
          tripId = a.body.id;
          version = a.body.version;
          assert.equal(
            await db.trip.count({
              where: { clientRequestId: baseTrip.clientRequestId },
            }),
            1,
          );
          assert.equal(
            (await post(driverAgent, "/trips", { ...baseTrip, endKm: 1301 }))
              .status,
            409,
          );
          const replay = await post(otherAgent, "/trips", { ...baseTrip });
          assert.equal(replay.status, 409);
          for (const controlCount of [null, 1]) {
            const changed = await post(driverAgent, "/trips", {
              ...baseTrip,
              controlCount,
            });
            assert.equal(changed.body.error.code, "IDEMPOTENCY_CONFLICT");
          }
          const list = await adminAgent.get(
            `/api/trips?driverId=${first.driver!.id}&pageSize=1`,
          );
          assert.equal(list.body.totals.distanceKm, 200);
          assert.equal(list.body.items[0].controlCount, 0);
          assert.equal(list.body.totals.allowance, "1250.50");
          assert.equal(
            (await otherAgent.get(`/api/trips/${tripId}`)).status,
            404,
          );
          assert.equal(
            (await otherAgent.get(`/api/trips/${tripId}/history`)).status,
            404,
          );
        },
      );
      await t.test(
        "cronología con viajes atrasados, cambios de camión y solapamiento",
        async () => {
          const old = await post(driverAgent, "/trips", {
            ...baseTrip,
            clientRequestId: randomUUID(),
            departureAt: date(-2),
            arrivalAt: date(-2, 3),
            startKm: 900,
            endKm: 950,
            controlCount: undefined,
            allowance: null,
          });
          assert.equal(old.status, 201, JSON.stringify(old.body));
          assert.equal(old.body.controlCount, null);
          const conflict = await post(driverAgent, "/trips", {
            ...baseTrip,
            clientRequestId: randomUUID(),
            departureAt: date(1),
            arrivalAt: date(1, 3),
            startKm: 900,
            endKm: 1050,
          });
          assert.equal(conflict.status, 409);
          const overlap = await post(driverAgent, "/trips", {
            ...baseTrip,
            clientRequestId: randomUUID(),
            departureAt: date(2, 1),
            arrivalAt: date(2, 2),
            startKm: 1100,
            endKm: 1200,
          });
          assert.equal(overlap.status, 409);
          const temporary = await post(adminAgent, "/trips", {
            ...baseTrip,
            driverId: first.driver!.id,
            controlCount: 3,
            clientRequestId: randomUUID(),
            truckId: secondTruck.id,
            departureAt: date(3),
            arrivalAt: date(3, 3),
            startKm: 5000,
            endKm: 5150,
          });
          assert.equal(temporary.status, 201);
          assert.equal(temporary.body.controlCount, 3);
          await patch(adminAgent, `/drivers/${first.driver!.id}`, {
            assignedTruckId: secondTruck.id,
          });
          assert.equal(
            (await driverAgent.get(`/api/trips/${tripId}`)).body.truckId,
            truck.id,
          );
          const list = await adminAgent.get(
            `/api/trips?driverId=${first.driver!.id}&pageSize=1`,
          );
          assert.equal(list.body.items.length, 1);
          assert.equal(list.body.totals.count, 3);
          assert.equal(list.body.totals.distanceKm, 400);
        },
      );
      await t.test(
        "revisión, corrección administrativa y control de versiones",
        async () => {
          const reviewed = await post(adminAgent, `/trips/${tripId}/review`, {
            version,
          });
          assert.equal(reviewed.status, 200);
          version = reviewed.body.version;
          assert.equal(
            (
              await patch(driverAgent, `/trips/${tripId}`, {
                notes: "No autorizado",
                controlCount: 5,
                version,
              })
            ).status,
            403,
          );
          const stale = await patch(adminAgent, `/trips/${tripId}`, {
            notes: "Versión vieja",
            version: version - 1,
          });
          assert.equal(stale.status, 409);
          const corrected = await patch(adminAgent, `/trips/${tripId}`, {
            endKm: 1320,
            controlCount: 2,
            notes: "Corregido",
            version,
          });
          assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
          assert.equal(corrected.body.reviewedAt, null);
          assert.equal(corrected.body.controlCount, 2);
          version = corrected.body.version;
          const history = await adminAgent.get(`/api/trips/${tripId}/history`);
          const correction = history.body.items.find(
            (entry: { action: string }) => entry.action === "UPDATED",
          );
          assert.equal(correction.before.controlCount, 0);
          assert.equal(correction.after.controlCount, 2);
          assert.ok(history.body.items.length >= 3);
          assert.ok(
            history.body.items.every(
              (a: { actor: { name: string } }) => a.actor.name,
            ),
          );
        },
      );
      await t.test(
        "services históricos, vencimiento combinado y renovación con historial",
        async () => {
          const created = await post(adminAgent, "/obligations", {
            title: "Aceite prueba",
            kind: "SERVICE",
            truckId: truck.id,
            dueDate: businessDay(new Date(Date.now() + 60 * 86_400_000)),
            dueKm: 1320,
            intervalKm: 10000,
            intervalMonths: 6,
            initialRecord: { performedAt: date(-5), odometer: 800 },
          });
          assert.equal(created.status, 201, JSON.stringify(created.body));
          obligationId = created.body.id;
          createdObligations.push(obligationId);
          obligationVersion = created.body.version;
          assert.equal(created.body.status, "OVERDUE");
          const contradiction = await post(
            adminAgent,
            `/obligations/${obligationId}/renewals`,
            {
              performedAt: date(5),
              odometer: 1200,
              nextDueKm: 11200,
              nextDueDate: businessDay(new Date(Date.now() + 60 * 86_400_000)),
              version: obligationVersion,
            },
          );
          assert.equal(contradiction.status, 409);
          const renewed = await post(
            adminAgent,
            `/obligations/${obligationId}/renewals`,
            {
              performedAt: date(5),
              odometer: 1400,
              nextDueKm: 11400,
              nextDueDate: businessDay(new Date(Date.now() + 60 * 86_400_000)),
              version: obligationVersion,
            },
          );
          assert.equal(renewed.status, 201, JSON.stringify(renewed.body));
          obligationVersion = renewed.body.version;
          assert.equal(renewed.body.status, "OK");
          assert.equal(renewed.body.truck.odometer, 1400);
          assert.equal(
            (await adminAgent.get(`/api/obligations/${obligationId}/renewals`))
              .body.items.length,
            2,
          );
          assert.equal(
            (
              await patch(adminAgent, `/obligations/${obligationId}`, {
                truckId: secondTruck.id,
                version: obligationVersion,
              })
            ).status,
            409,
          );
          const badOwner = await post(adminAgent, "/obligations", {
            title: "Documento",
            kind: "DOCUMENT",
            driverId: first.driver!.id,
            dueKm: 10000,
          });
          assert.equal(badOwner.status, 400);
        },
      );
      await t.test(
        "renovación pendiente explícita y fechas después de medianoche UTC respetan Argentina",
        async () => {
          const documentary = await post(adminAgent, "/obligations", {
            title: "Licencia prueba",
            kind: "DOCUMENT",
            driverId: first.driver!.id,
            intervalMonths: 12,
            dueDate: businessDay(),
          });
          assert.equal(documentary.status, 201);
          createdObligations.push(documentary.body.id);
          const previousDay = businessDay(
            new Date(Date.now() - 2 * 86_400_000),
          );
          const performedAt = new Date(
            `${previousDay}T22:30:00-03:00`,
          ).toISOString();
          const sameDate = await post(
            adminAgent,
            `/obligations/${documentary.body.id}/renewals`,
            {
              performedAt,
              odometer: null,
              nextDueDate: previousDay,
              nextDueKm: null,
              version: documentary.body.version,
            },
          );
          assert.equal(sameDate.status, 201, JSON.stringify(sameDate.body));
          const pending = await post(
            adminAgent,
            `/obligations/${documentary.body.id}/renewals`,
            {
              performedAt: new Date(Date.now() - 86_400_000).toISOString(),
              nextDueDate: null,
              nextDueKm: null,
              version: sameDate.body.version,
            },
          );
          assert.equal(pending.status, 201, JSON.stringify(pending.body));
          assert.equal(pending.body.status, "UNCONFIGURED");
        },
      );
      await t.test(
        "Excel numérico y textos que no se interpretan como fórmulas",
        async () => {
          assert.equal(
            (await driverAgent.get("/api/trips/export")).status,
            403,
          );
          const exportTrips = (query: string) => adminAgent
            .get(`/api/trips/export?driverId=${first.driver!.id}&${query}`)
            .buffer(true)
            .parse((res, done) => {
              const parts: Buffer[] = [];
              res.on("data", (d) => parts.push(Buffer.from(d)));
              res.on("end", () => done(null, Buffer.concat(parts)));
            });
          const form = await exportTrips(`truckId=${secondTruck.id}`);
          assert.equal(form.status, 200);
          assert.match(form.headers["content-disposition"], /planilla-kilometraje-tomasini\.xlsx/);
          const formFiles = unzipSync(form.body);
          const formSheet = strFromU8(formFiles["xl/worksheets/sheet1.xml"]);
          const strings = strFromU8(formFiles["xl/sharedStrings.xml"]);
          assert.match(strings, /CONVENCIÓN COLECTIVA/);
          assert.ok(strings.includes(secondTruck.plate));
          assert.ok(!strings.includes(truck.plate));
          assert.doesNotMatch(strings, /Viáticos ARS|Observaciones|Acoplado/);
          assert.match(formSheet, /<c r="G5"[^>]*><v>150<\/v>/);
          assert.match(formSheet, /<c r="J5"[^>]*><v>3<\/v>/);
          assert.match(formSheet, /<c r="C5"[^>]* t="s">/);
          const response = await exportTrips("format=detail");
          assert.equal(response.status, 200);
          const files = unzipSync(response.body);
          const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
          assert.equal(sheet.includes("<f>"), false);
          assert.match(sheet, /1250\.5/);
          assert.ok(files["xl/workbook.xml"]);
        },
      );
      await t.test(
        "avisos diarios con reintentos, deduplicación y sin enviar correo real",
        async () => {
          const today = businessDay(),
            now = new Date(`${today}T12:00:00-03:00`),
            recipient = `prueba-${suffix}@example.invalid`;
          await db.setting.update({
            where: { id: "main" },
            data: { recipientEmail: recipient },
          });
          const doc = await post(adminAgent, "/obligations", {
            title: "Seguro vencido prueba",
            kind: "DOCUMENT",
            truckId: truck.id,
            dueDate: today,
          });
          assert.equal(doc.status, 201);
          createdObligations.push(doc.body.id);
          let sends = 0;
          const before = await runNotificationJob({
            now: new Date(`${today}T07:00:00-03:00`),
            configured: true,
            send: async () => {
              sends++;
            },
          });
          assert.equal(before.reason, "BEFORE_SEND_HOUR");
          const failed = await runNotificationJob({
            now,
            configured: true,
            send: async () => {
              sends++;
              throw Object.assign(new Error("sensitive smtp detail"), {
                code: "EAUTH",
              });
            },
          });
          assert.equal(failed.reason, "RETRY_SCHEDULED");
          const tooSoon = await runNotificationJob({
            now: new Date(now.getTime() + 1000),
            configured: true,
            send: async () => {
              sends++;
            },
          });
          assert.equal(tooSoon.reason, "WAITING_OR_CLAIMED");
          const results = await Promise.all([
            runNotificationJob({
              now: new Date(now.getTime() + 16 * 60_000),
              configured: true,
              send: async () => {
                sends++;
              },
            }),
            runNotificationJob({
              now: new Date(now.getTime() + 16 * 60_000),
              configured: true,
              send: async () => {
                sends++;
              },
            }),
          ]);
          assert.equal(results.filter((r) => r.sent === 1).length, 1);
          assert.equal(sends, 2);
          const saved = await db.notification.findUniqueOrThrow({
            where: { date_recipient: { date: new Date(today), recipient } },
          });
          assert.equal(saved.status, "SENT");
          assert.equal(saved.attempts, 2);
          assert.equal(
            (
              await runNotificationJob({
                now,
                configured: true,
                send: async () => {
                  sends++;
                },
              })
            ).reason,
            "SENT",
          );
          assert.equal(sends, 2);
        },
      );
      await t.test(
        "anulación conserva auditoría y no borra la lectura de service posterior",
        async () => {
          const response = await post(adminAgent, `/trips/${tripId}/cancel`, {
            version,
            reason: "Registro duplicado en papel",
          });
          assert.equal(response.status, 200);
          assert.equal(response.body.status, "CANCELLED");
          const rows = await driverAgent.get("/api/trucks");
          assert.equal(
            rows.body.items.find((r: { id: string }) => r.id === truck.id)
              .odometer,
            1400,
          );
          assert.equal(
            (await adminAgent.get(`/api/trips/${tripId}/history`)).body.items[0]
              .action,
            "CANCELLED",
          );
        },
      );
      await t.test(
        "reset revoca sesiones, exige cambio y baja impide ingresar",
        async () => {
          assert.equal(
            (
              await post(adminAgent, `/drivers/${first.driver!.id}/password`, {
                password: "Provisoria-nueva-12345",
              })
            ).status,
            204,
          );
          assert.equal((await driverAgent.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(driverAgent, "/auth/login", {
                username: first.username,
                password: "Provisoria-nueva-12345",
              })
            ).status,
            200,
          );
          assert.equal((await driverAgent.get("/api/dashboard")).status, 403);
          assert.equal(
            (
              await post(driverAgent, "/auth/password", {
                currentPassword: "Provisoria-nueva-12345",
                newPassword: "Definitiva-nueva-12345",
              })
            ).status,
            204,
          );
          assert.equal((await driverAgent.get("/api/dashboard")).status, 200);
          assert.equal(
            (
              await patch(adminAgent, `/drivers/${first.driver!.id}`, {
                active: false,
              })
            ).status,
            200,
          );
          assert.equal((await driverAgent.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(driverAgent, "/auth/login", {
                username: first.username,
                password: "Definitiva-nueva-12345",
              })
            ).status,
            401,
          );
          assert.equal(
            (await post(adminAgent, "/auth/logout", {})).status,
            204,
          );
          assert.equal((await adminAgent.get("/api/dashboard")).status, 401);
        },
      );
    } finally {
      const userIds = [admin.id, first.id, other.id],
        truckIds = [truck.id, secondTruck.id];
      await db.notification.deleteMany({
        where: { recipient: `prueba-${suffix}@example.invalid` },
      });
      await db.setting.update({
        where: { id: "main" },
        data: {
          recipientEmail: previousSettings.recipientEmail,
          warningDays: previousSettings.warningDays,
          warningKm: previousSettings.warningKm,
        },
      });
      await db.audit.deleteMany({ where: { actorId: { in: userIds } } });
      await db.renewal.deleteMany({ where: { createdById: { in: userIds } } });
      await db.obligation.deleteMany({
        where: {
          OR: [
            { truckId: { in: truckIds } },
            { driverId: { in: [first.driver!.id, other.driver!.id] } },
          ],
        },
      });
      await db.trip.deleteMany({ where: { truckId: { in: truckIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.driver.deleteMany({ where: { userId: { in: userIds } } });
      await db.truck.deleteMany({ where: { id: { in: truckIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await disconnect();
    }
  },
);

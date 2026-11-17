import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";
import {
  emptyHolidayYear,
  type HolidayCalendar,
} from "../src/holiday-domain.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";

test(
  "km al 100% integra calendario, viajes auditables y Excel en PostgreSQL aislado",
  {
    skip: !enabled,
    timeout: 120_000,
  },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      suffix = randomUUID().slice(0, 8);
    const password = "Clave-ficticia-km100-2026",
      passwordHash = await hashPassword(password);
    const previousSettings = await db.setting.findUniqueOrThrow({
      where: { id: "main" },
    });
    const userIds: string[] = [],
      truckIds: string[] = [];
    const origin = getConfig().origin;
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
    const put = (agent: typeof adminAgent, path: string, body: object) =>
      agent
        .put(`/api${path}`)
        .set("X-Tomasini-Request", "1")
        .set("Origin", origin)
        .send(body);
    const local = (day: string, hour: number) =>
      `${day}T${String(hour).padStart(2, "0")}:00:00-03:00`;
    try {
      const admin = await db.user.create({
        data: {
          username: `km_admin_${suffix}`,
          name: "Admin ficticio km100",
          role: "ADMIN",
          passwordHash,
          mustChangePassword: false,
        },
      });
      userIds.push(admin.id);
      const driver = await db.user.create({
        data: {
          username: `km_driver_${suffix}`,
          name: "Chofer ficticio km100",
          role: "DRIVER",
          passwordHash,
          mustChangePassword: false,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      userIds.push(driver.id);
      const other = await db.user.create({
        data: {
          username: `km_other_${suffix}`,
          name: "Otro chofer ficticio",
          role: "DRIVER",
          passwordHash,
          mustChangePassword: false,
          driver: { create: {} },
        },
        include: { driver: true },
      });
      userIds.push(other.id);
      const truck = await db.truck.create({
        data: {
          plate: `KM${suffix.toUpperCase()}`,
          label: "Unidad ficticia km100",
          initialOdometer: 1000,
          initialOdometerAt: new Date("2024-01-01T00:00:00-03:00"),
        },
      });
      truckIds.push(truck.id);
      const calendar2024 = {
        ...emptyHolidayYear(2024),
        confirmedAt: "2024-01-01T03:00:00.000Z",
        version: 1,
        revision: 1,
      };
      const calendar: HolidayCalendar = {
        schemaVersion: 1,
        years: { "2024": calendar2024 },
        lastSyncDay: null,
      };
      await db.setting.update({
        where: { id: "main" },
        data: { holidayCalendar: JSON.stringify(calendar) },
      });
      for (const [agent, user] of [
        [adminAgent, admin],
        [driverAgent, driver],
        [otherAgent, other],
      ] as const) {
        const response = await post(agent, "/auth/login", {
          username: user.username,
          password,
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
      }

      const tripInput = (
        day: string,
        start: number,
        end: number,
        startKm: number,
        endKm: number,
      ) => ({
        clientRequestId: randomUUID(),
        truckId: truck.id,
        origin: "Origen ficticio",
        destination: "Destino ficticio",
        departureAt: local(day, start),
        arrivalAt: local(day, end),
        startKm,
        endKm,
      });
      const preview = async (input: ReturnType<typeof tripInput>) => {
        const response = await post(driverAgent, "/trips/km100-preview", {
          departureAt: input.departureAt,
          arrivalAt: input.arrivalAt,
          startKm: input.startKm,
          endKm: input.endKm,
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return response.body;
      };
      const noneInput = tripInput("2024-06-03", 10, 12, 1000, 1100);
      const fullInput = tripInput("2024-06-09", 10, 12, 1100, 1200);
      const partialInput = tripInput("2024-06-15", 10, 18, 1200, 1600);
      const pendingInput = tripInput("2025-06-02", 10, 18, 2000, 2200);
      let noneId = "",
        fullId = "",
        partialId = "",
        pendingId = "",
        pendingVersion = 1;
      let originalNoneRequest: object = {};

      await t.test(
        "preview requiere sesión y CSRF; gestión del calendario y exportación son exclusivas de administración",
        async () => {
          assert.equal(
            (
              await request(app)
                .post("/api/trips/km100-preview")
                .set("X-Tomasini-Request", "1")
                .set("Origin", origin)
                .send({})
            ).status,
            401,
          );
          assert.equal(
            (await driverAgent.post("/api/trips/km100-preview").send({}))
              .status,
            403,
          );
          assert.equal(
            (await driverAgent.get("/api/holiday-calendar/2024")).status,
            403,
          );
          assert.equal(
            (
              await put(driverAgent, "/holiday-calendar/2024", {
                version: 1,
                entries: [],
                confirm: true,
              })
            ).status,
            403,
          );
          assert.equal(
            (await driverAgent.get("/api/trips/export?format=detail")).status,
            403,
          );
        },
      );

      await t.test(
        "NONE y FULL guardan cero o toda la distancia, rechazando una declaración contradictoria",
        async () => {
          const nonePreview = await preview(noneInput);
          assert.equal(nonePreview.mode, "NONE");
          assert.equal(nonePreview.suggestedKm, 0);
          const invalid = await post(driverAgent, "/trips", {
            ...noneInput,
            km100: 1,
          });
          assert.equal(invalid.status, 400);
          assert.equal(invalid.body.error.code, "KM100_RANGE");
          originalNoneRequest = {
            ...noneInput,
            km100: 0,
            km100CalendarToken: nonePreview.calendarToken,
          };
          const none = await post(driverAgent, "/trips", originalNoneRequest);
          assert.equal(none.status, 201, JSON.stringify(none.body));
          noneId = none.body.id;
          assert.equal(none.body.km100, 0);
          assert.equal(none.body.km100Context.mode, "NONE");
          const fullPreview = await preview(fullInput);
          assert.equal(fullPreview.mode, "FULL");
          assert.equal(fullPreview.suggestedKm, 100);
          assert.equal(
            (await post(driverAgent, "/trips", { ...fullInput, km100: 0 }))
              .status,
            400,
          );
          const full = await post(driverAgent, "/trips", fullInput);
          assert.equal(full.status, 201, JSON.stringify(full.body));
          fullId = full.body.id;
          assert.equal(full.body.km100, 100);
          assert.equal(full.body.km100Context.mode, "FULL");
          assert.equal(
            (await otherAgent.get(`/api/trips/${noneId}`)).status,
            404,
          );
          assert.equal(
            (
              await patch(otherAgent, `/trips/${noneId}`, {
                version: 1,
                km100: 0,
              })
            ).status,
            404,
          );
        },
      );

      await t.test(
        "PARTIAL exige un entero dentro del recorrido y acepta cero explícito",
        async () => {
          const result = await preview(partialInput);
          assert.equal(result.mode, "PARTIAL");
          assert.equal(result.suggestedKm, null);
          assert.match(result.intervals[0].start, /^2024-06-15T16:00:00/);
          const missing = await post(driverAgent, "/trips", partialInput);
          assert.equal(missing.status, 400);
          assert.equal(missing.body.error.code, "KM100_REQUIRED");
          for (const km100 of [-1, 1.5, 401]) {
            const invalid = await post(driverAgent, "/trips", {
              ...partialInput,
              km100,
            });
            assert.equal(
              invalid.status,
              400,
              `No debe aceptar ${km100}: ${JSON.stringify(invalid.body)}`,
            );
            assert.ok(invalid.body.error.fields.km100);
          }
          const created = await post(driverAgent, "/trips", {
            ...partialInput,
            km100: 0,
            km100CalendarToken: result.calendarToken,
          });
          assert.equal(created.status, 201, JSON.stringify(created.body));
          partialId = created.body.id;
          assert.equal(created.body.km100, 0);
          assert.equal(created.body.km100Context.mode, "PARTIAL");
          const corrected = await patch(driverAgent, `/trips/${partialId}`, {
            version: 1,
            km100: 175,
            km100CalendarToken: result.calendarToken,
          });
          assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
          assert.equal(corrected.body.km100, 175);
          const changes = await adminAgent.get(
            `/api/trips/${partialId}/history`,
          );
          assert.equal(changes.status, 200);
          const update = changes.body.items.find(
            (event: { action: string }) => event.action === "UPDATED",
          );
          assert.equal(update.before.km100, 0);
          assert.equal(update.after.km100, 175);
        },
      );

      await t.test(
        "el calendario obsoleto rechaza nuevos guardados y los reintentos conservan el viaje original",
        async () => {
          const future = tripInput("2024-06-17", 8, 10, 1600, 1700);
          const before = await preview(future);
          const updatedCalendar = await put(
            adminAgent,
            "/holiday-calendar/2024",
            {
              version: 1,
              confirm: true,
              entries: [
                {
                  date: "2024-06-03",
                  name: "Día especial de prueba",
                  source: "manual",
                  enabled: true,
                },
                {
                  date: "2024-06-17",
                  name: "Otro día especial de prueba",
                  source: "manual",
                  enabled: true,
                },
              ],
            },
          );
          assert.equal(
            updatedCalendar.status,
            200,
            JSON.stringify(updatedCalendar.body),
          );
          const stale = await post(driverAgent, "/trips", {
            ...future,
            km100: 0,
            km100CalendarToken: before.calendarToken,
          });
          assert.equal(stale.status, 409);
          assert.equal(stale.body.error.code, "KM100_CALENDAR_CHANGED");
          const current = await preview(future);
          assert.equal(current.mode, "FULL");
          assert.notEqual(current.calendarToken, before.calendarToken);
          const created = await post(driverAgent, "/trips", {
            ...future,
            km100: 100,
            km100CalendarToken: current.calendarToken,
          });
          assert.equal(created.status, 201, JSON.stringify(created.body));
          const retry = await post(driverAgent, "/trips", originalNoneRequest);
          assert.equal(retry.status, 200, JSON.stringify(retry.body));
          assert.equal(retry.body.id, noneId);
          assert.equal(retry.body.km100, 0);
          assert.equal(retry.body.km100Context.mode, "NONE");
          assert.equal(
            await db.trip.count({
              where: { clientRequestId: noneInput.clientRequestId },
            }),
            1,
          );
          const different = await post(driverAgent, "/trips", {
            ...noneInput,
            km100: 100,
          });
          assert.equal(different.status, 409);
          assert.equal(different.body.error.code, "IDEMPOTENCY_CONFLICT");
          assert.equal(
            (await driverAgent.get(`/api/trips/${fullId}`)).body.km100,
            100,
          );
          assert.equal(
            (await driverAgent.get(`/api/trips/${partialId}`)).body.km100,
            175,
          );
        },
      );

      await t.test(
        "PENDING permite declaración manual, impide revisión y no permite resolver sin calendario confirmado",
        async () => {
          const result = await preview(pendingInput);
          assert.equal(result.mode, "PENDING");
          assert.deepEqual(result.missingYears, [2025]);
          const missing = await post(driverAgent, "/trips", pendingInput);
          assert.equal(missing.status, 400);
          assert.equal(missing.body.error.code, "KM100_REQUIRED");
          const created = await post(driverAgent, "/trips", {
            ...pendingInput,
            km100: 80,
            km100CalendarToken: result.calendarToken,
          });
          assert.equal(created.status, 201, JSON.stringify(created.body));
          pendingId = created.body.id;
          pendingVersion = created.body.version;
          assert.equal(created.body.km100, 80);
          assert.equal(created.body.km100Context.mode, "PENDING");
          const review = await post(adminAgent, `/trips/${pendingId}/review`, {
            version: pendingVersion,
          });
          assert.equal(review.status, 409);
          assert.equal(review.body.error.code, "KM100_CALENDAR_PENDING");
          assert.equal(
            (
              await patch(driverAgent, `/trips/${pendingId}`, {
                version: pendingVersion,
                km100: 80,
                km100Resolve: true,
              })
            ).status,
            403,
          );
          const unresolved = await patch(adminAgent, `/trips/${pendingId}`, {
            version: pendingVersion,
            km100: 80,
            km100Resolve: true,
          });
          assert.equal(unresolved.status, 409);
          assert.equal(unresolved.body.error.code, "KM100_CALENDAR_PENDING");
        },
      );

      const exportTrips = (query: string) =>
        adminAgent
          .get(`/api/trips/export?driverId=${driver.driver!.id}&${query}`)
          .buffer(true)
          .parse((res, done) => {
            const parts: Buffer[] = [];
            res.on("data", (chunk) => parts.push(Buffer.from(chunk)));
            res.on("end", () => done(null, Buffer.concat(parts)));
          });

      await t.test(
        "Excel del contador omite el provisional, mantiene el total y el detalle identifica la declaración pendiente",
        async () => {
          for (const query of [
            "format=monthly&month=2025-06",
            "format=form&from=2025-06-01&to=2025-06-30",
          ]) {
            const result = await exportTrips(query);
            assert.equal(result.status, 200);
            const files = unzipSync(result.body);
            const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
            assert.match(sheet, /<c r="G5"[^>]*><v>200<\/v>/);
            assert.match(sheet, /<c r="H5"[^>]*\/>/);
            assert.match(sheet, /COUNT\(H5:H\d+\)=COUNT\(A5:A\d+\)/);
          }
          const detail = await exportTrips(
            "format=detail&from=2025-06-01&to=2025-06-30",
          );
          assert.equal(detail.status, 200);
          const files = unzipSync(detail.body);
          assert.match(
            strFromU8(files["xl/worksheets/sheet1.xml"]),
            /<c r="O2"[^>]*><v>80<\/v>/,
          );
          assert.match(
            strFromU8(files["xl/sharedStrings.xml"]),
            /Provisional: calendario pendiente/,
          );
        },
      );

      await t.test(
        "confirmar calendario no modifica viajes; resolver exige corregir una declaración incompatible y queda auditado",
        async () => {
          const confirmed = await put(adminAgent, "/holiday-calendar/2025", {
            version: 0,
            confirm: true,
            entries: [
              {
                date: "2025-06-02",
                name: "Feriado ficticio para resolver",
                source: "manual",
                enabled: true,
              },
            ],
          });
          assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
          const unchanged = await driverAgent.get(`/api/trips/${pendingId}`);
          assert.equal(unchanged.body.km100, 80);
          assert.equal(unchanged.body.km100Context.mode, "PENDING");
          assert.equal(unchanged.body.version, pendingVersion);
          const notes = await patch(driverAgent, `/trips/${pendingId}`, {
            version: pendingVersion,
            notes: "Sigue pendiente hasta validación administrativa",
          });
          assert.equal(notes.status, 200, JSON.stringify(notes.body));
          pendingVersion = notes.body.version;
          assert.equal(notes.body.km100, 80);
          assert.equal(notes.body.km100Context.mode, "PENDING");
          const current = await preview(pendingInput);
          assert.equal(current.mode, "FULL");
          const wrong = await patch(adminAgent, `/trips/${pendingId}`, {
            version: pendingVersion,
            km100: 80,
            km100Resolve: true,
            km100CalendarToken: current.calendarToken,
          });
          assert.equal(wrong.status, 400);
          assert.equal(wrong.body.error.code, "KM100_RANGE");
          const resolved = await patch(adminAgent, `/trips/${pendingId}`, {
            version: pendingVersion,
            km100: 200,
            km100Resolve: true,
            km100CalendarToken: current.calendarToken,
          });
          assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
          assert.equal(resolved.body.km100, 200);
          assert.equal(resolved.body.km100Context.mode, "FULL");
          const review = await post(adminAgent, `/trips/${pendingId}/review`, {
            version: resolved.body.version,
          });
          assert.equal(review.status, 200, JSON.stringify(review.body));
          assert.ok(review.body.reviewedAt);
          assert.equal(
            (
              await patch(driverAgent, `/trips/${pendingId}`, {
                version: review.body.version,
                notes: "No autorizado",
              })
            ).status,
            403,
          );
          const history = await adminAgent.get(
            `/api/trips/${pendingId}/history`,
          );
          const resolvedAudit = history.body.items.find(
            (event: {
              action: string;
              after?: { km100?: number; km100Context?: { mode?: string } };
            }) =>
              event.action === "UPDATED" &&
              event.after?.km100 === 200 &&
              event.after.km100Context?.mode === "FULL",
          );
          assert.ok(resolvedAudit);
          assert.equal(resolvedAudit.before.km100, 80);
          assert.equal(resolvedAudit.before.km100Context.mode, "PENDING");
          const result = await exportTrips("format=monthly&month=2025-06");
          const sheet = strFromU8(
            unzipSync(result.body)["xl/worksheets/sheet1.xml"],
          );
          assert.match(sheet, /<c r="H5"[^>]*><v>200<\/v>/);
        },
      );

      await t.test(
        "viajes anteriores conservan null al editar notas y odómetros, y pueden revisarse sin completar el campo",
        async () => {
          const legacy = await db.trip.create({
            data: {
              clientRequestId: randomUUID(),
              requestHash: "a".repeat(64),
              createdById: driver.id,
              driverId: driver.driver!.id,
              truckId: truck.id,
              origin: "Origen histórico ficticio",
              destination: "Destino histórico ficticio",
              departureAt: new Date(local("2024-06-24", 10)),
              arrivalAt: new Date(local("2024-06-24", 12)),
              startKm: 1700,
              endKm: 1800,
            },
          });
          const notes = await patch(driverAgent, `/trips/${legacy.id}`, {
            version: 1,
            notes: "Corrección histórica",
          });
          assert.equal(notes.status, 200, JSON.stringify(notes.body));
          assert.equal(notes.body.km100, null);
          assert.equal(notes.body.km100Context, null);
          const odometer = await patch(driverAgent, `/trips/${legacy.id}`, {
            version: notes.body.version,
            startKm: 1710,
            endKm: 1850,
          });
          assert.equal(odometer.status, 200, JSON.stringify(odometer.body));
          assert.equal(odometer.body.km100, null);
          assert.equal(odometer.body.km100Context, null);
          const denied = await patch(adminAgent, `/trips/${legacy.id}`, {
            version: odometer.body.version,
            km100: 0,
          });
          assert.equal(denied.status, 400);
          assert.equal(denied.body.error.code, "KM100_LEGACY");
          const reviewed = await post(
            adminAgent,
            `/trips/${legacy.id}/review`,
            { version: odometer.body.version },
          );
          assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
          assert.ok(reviewed.body.reviewedAt);
          assert.equal(reviewed.body.km100, null);
        },
      );
    } finally {
      await db.setting.update({
        where: { id: "main" },
        data: { holidayCalendar: previousSettings.holidayCalendar },
      });
      await db.audit.deleteMany({ where: { actorId: { in: userIds } } });
      await db.trip.deleteMany({ where: { truckId: { in: truckIds } } });
      await db.session.deleteMany({ where: { userId: { in: userIds } } });
      await db.driver.deleteMany({ where: { userId: { in: userIds } } });
      await db.truck.deleteMany({ where: { id: { in: truckIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await disconnect();
    }
  },
);

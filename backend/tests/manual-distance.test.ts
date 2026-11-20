import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import request from "supertest";
import { unzipSync, strFromU8 } from "fflate";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { businessDay, dayStart } from "../src/domain.js";
import { hashPassword } from "../src/password.js";
import { MANUAL_DISTANCE_ENABLED } from "../src/manual-distance-enabled.js";
import { resolveFixtureKm100 } from "./km100-fixtures.js";

test(
  "kilómetros directos: convivencia de las dos versiones, historial, permisos y tres Excel",
  {
    skip:
      process.env.TOMASINI_INTEGRATION !== "1" &&
      process.env.NODE_ENV !== "test",
    timeout: 120_000,
  },
  async () => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["localhost", "127.0.0.1"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb();
    const suffix = randomUUID().slice(0, 8);
    const password = "Clave-ficticia-para-prueba";
    const passwordHash = await hashPassword(password);
    const account = (role: "ADMIN" | "DRIVER", prefix: string) =>
      db.user.create({
        data: {
          username: prefix.toLowerCase() + suffix,
          name: "Cuenta de prueba " + prefix,
          role,
          passwordHash,
          mustChangePassword: false,
          ...(role === "DRIVER" ? { driver: { create: {} } } : {}),
        },
        include: { driver: true },
      });
    const admin = await account("ADMIN", "adminKm");
    const driver = await account("DRIVER", "choferKm");
    const other = await account("DRIVER", "otroKm");
    const userIds = [admin.id, driver.id, other.id];
    const truck = await db.truck.create({
      data: { plate: "KM" + suffix, label: "Camión de prueba" },
    });
    const spare = await db.truck.create({
      data: { plate: "KS" + suffix, label: "Camión de prueba" },
    });
    const trailer = await db.trailer.create({
      data: { plate: "KA" + suffix, label: "Acoplado de prueba" },
    });
    const obligation = await db.obligation.create({
      data: {
        kind: "SERVICE",
        truckId: truck.id,
        title: "Service de prueba",
        dueKm: 2050,
        warningKm: 100,
      },
    });
    const origin = getConfig().origin;
    type Agent = ReturnType<typeof request.agent>;
    const write = (
      client: Agent,
      method: "post" | "patch",
      path: string,
      body: object,
    ) =>
      client[method]("/api" + path)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const login = async (client: Agent, username: string) => {
      await write(client, "post", "/auth/login", { username, password }).expect(
        200,
      );
      return client;
    };
    const stageA = createApp({
      manualDistanceEnabled: false,
      operationalDistanceEnabled: false,
    });
    const stageB = createApp({
      manualDistanceEnabled: true,
      operationalDistanceEnabled: false,
    });
    // Keep all report fixtures in one Argentine month, including runs near midnight.
    const now = Date.now();
    const monthStart = dayStart(
      businessDay(new Date(now)).slice(0, 7) + "-01",
    ).getTime();
    const end = now - monthStart < 30_000 ? monthStart - 1 : now;
    const step = Math.min(
      3_600_000,
      Math.max(1_000, Math.floor((end - monthStart) / 10)),
    );
    const at = (n: number) => new Date(end - n * step).toISOString();
    const base = {
      driverId: driver.driver!.id,
      truckId: truck.id,
      origin: "A",
      destination: "B",
    };
    const measured = {
      ...base,
      clientRequestId: randomUUID(),
      departureAt: at(8),
      arrivalAt: at(7),
      startKm: 1000,
      endKm: 1200,
    };
    const manual = {
      ...base,
      clientRequestId: randomUUID(),
      trailerId: trailer.id,
      departureAt: at(5),
      arrivalAt: at(4),
      mileageMode: "DISTANCE",
      distanceKm: 350,
    };
    const manualPreview = {
      departureAt: manual.departureAt,
      arrivalAt: manual.arrivalAt,
      mileageMode: "DISTANCE",
      distanceKm: 350,
    };
    try {
      const oldAdmin = await login(request.agent(stageA), admin.username);
      const newAdmin = await login(request.agent(stageB), admin.username);
      const owner = await login(request.agent(stageB), driver.username);
      const foreign = await login(request.agent(stageB), other.username);
      const actualReleaseAdmin = await login(
        request.agent(createApp()),
        admin.username,
      );
      await write(
        actualReleaseAdmin,
        "post",
        "/trips/km100-preview",
        manualPreview,
      ).expect(MANUAL_DISTANCE_ENABLED ? 200 : 409);
      await write(oldAdmin, "post", "/trips", manual).expect(409);
      await write(owner, "post", "/trips", manual).expect(403);
      await write(owner, "post", "/trips/km100-preview", manualPreview).expect(
        403,
      );
      for (const invalid of [
        { distanceKm: -1 },
        { distanceKm: 1.5 },
        { distanceKm: 10_000_000 },
        { startKm: 0 },
        { distanceKm: null },
        { distanceKm: undefined },
      ]) {
        await write(newAdmin, "post", "/trips", {
          ...manual,
          ...invalid,
        }).expect(400);
      }
      const measuredPreview = await write(
        owner,
        "post",
        "/trips/km100-preview",
        {
          departureAt: measured.departureAt,
          arrivalAt: measured.arrivalAt,
          startKm: measured.startKm,
          endKm: measured.endKm,
        },
      ).expect(200);
      const legacyPayload = {
        ...measured,
        km100: measuredPreview.body.suggestedKm ?? 0,
      };
      const normal = (
        await write(owner, "post", "/trips", legacyPayload).expect(201)
      ).body;
      const stored = await db.trip.findUniqueOrThrow({
        where: { id: normal.id },
      });
      const oldHash = createHash("sha256")
        .update(
          JSON.stringify({
            driverId: base.driverId,
            truckId: base.truckId,
            origin: base.origin,
            destination: base.destination,
            departureAt: measured.departureAt,
            arrivalAt: measured.arrivalAt,
            startKm: 1000,
            endKm: 1200,
            allowance: null,
            notes: null,
            km100: legacyPayload.km100,
          }),
        )
        .digest("hex");
      assert.equal(stored.requestHash, oldHash);
      await write(owner, "post", "/trips", {
        ...legacyPayload,
        mileageMode: "ODOMETER",
      }).expect(200);
      await write(newAdmin, "patch", "/trips/" + normal.id, {
        version: 1,
        mileageMode: "DISTANCE",
        distanceKm: 200,
      }).expect(400);
      const preview = (
        await write(
          newAdmin,
          "post",
          "/trips/km100-preview",
          manualPreview,
        ).expect(200)
      ).body;
      const payload = {
        ...manual,
        km100: preview.suggestedKm ?? 0,
        km100CalendarToken: preview.calendarToken,
      };
      const direct = (
        await write(newAdmin, "post", "/trips", payload).expect(201)
      ).body;
      await write(newAdmin, "post", "/trips", payload).expect(200);
      await write(newAdmin, "post", "/trips", {
        ...payload,
        distanceKm: 351,
      }).expect(409);
      const path = "/trips/" + direct.id;
      for (const client of [oldAdmin, newAdmin, owner]) {
        const row = (await client.get("/api" + path).expect(200)).body;
        assert.deepEqual(
          [row.mileageMode, row.startKm, row.endKm, row.distanceKm],
          ["DISTANCE", null, null, 350],
        );
      }
      await foreign.get("/api" + path).expect(404);
      await write(owner, "patch", path, { version: 1, notes: "Cambio" }).expect(
        403,
      );
      await write(foreign, "patch", path, { version: 1, distanceKm: 4 }).expect(
        404,
      );
      await write(oldAdmin, "patch", path, {
        version: 1,
        distanceKm: 4,
      }).expect(409);
      await write(newAdmin, "patch", path, {
        version: 1,
        mileageMode: "ODOMETER",
        startKm: 1200,
        endKm: 1550,
      }).expect(400);
      await write(newAdmin, "patch", path, {
        version: 1,
        startKm: 1200,
      }).expect(400);
      const list = (
        await oldAdmin
          .get("/api/trips")
          .query({ driverId: base.driverId, pageSize: 1 })
          .expect(200)
      ).body;
      assert.equal(list.totals.distanceKm, 550);
      const dashboard = (await owner.get("/api/dashboard").expect(200)).body;
      assert.equal(
        dashboard.stats.kilometersThisMonth,
        end >= monthStart ? 550 : 0,
      );
      const truckInfo = dashboard.trucks.find(
        (row: { id: string }) => row.id === truck.id,
      );
      assert.deepEqual(
        [truckInfo.odometer, truckInfo.odometerAt],
        [1200, measured.arrivalAt],
      );
      const due = (
        await oldAdmin.get("/api/obligations").expect(200)
      ).body.items.find((row: { id: string }) => row.id === obligation.id);
      assert.equal(due.kmRemaining, 850);
      for (const conflict of [
        {
          driverId: other.driver!.id,
          truckId: spare.id,
          trailerId: trailer.id,
        },
        { driverId: other.driver!.id, truckId: truck.id, trailerId: null },
        { driverId: base.driverId, truckId: spare.id, trailerId: null },
      ]) {
        await write(newAdmin, "post", "/trips", {
          ...payload,
          ...conflict,
          clientRequestId: randomUUID(),
        }).expect(409);
      }
      for (const format of ["detail", "form", "monthly"]) {
        const response = await oldAdmin
          .get("/api/trips/export")
          .query({
            driverId: base.driverId,
            format,
            ...(format === "monthly"
              ? { month: businessDay(new Date(manual.departureAt)).slice(0, 7) }
              : {}),
          })
          .buffer(true)
          .parse((res, done) => {
            const parts: Buffer[] = [];
            res.on("data", (chunk) => parts.push(Buffer.from(chunk)));
            res.on("end", () => done(null, Buffer.concat(parts)));
          })
          .expect(200);
        const xml = strFromU8(
          unzipSync(response.body)["xl/worksheets/sheet1.xml"],
        );
        if (format === "detail") {
          assert.match(xml, /<c r="J3"[^>]*><v>350<\/v>/);
          assert.doesNotMatch(xml, /<c r="[HI]3"[^>]*><v>/);
        } else {
          assert.match(xml, /<c r="G6"[^>]*><v>350<\/v>/);
        }
      }
      const resolved = await resolveFixtureKm100(newAdmin, origin, direct.id);
      const reviewed = (
        await write(newAdmin, "post", path + "/review", {
          version: resolved.version,
        }).expect(200)
      ).body;
      assert.ok(
        (await oldAdmin.get("/api" + path).expect(200)).body.reviewedAt,
      );
      const corrected = (
        await write(newAdmin, "patch", path, {
          version: reviewed.version,
          distanceKm: 0,
          km100: 0,
        }).expect(200)
      ).body;
      assert.equal(corrected.distanceKm, 0);
      assert.equal(corrected.km100, 0);
      assert.equal(corrected.reviewedAt, null);
      await write(newAdmin, "patch", path, {
        version: reviewed.version,
        distanceKm: 100,
      }).expect(409);
      await write(newAdmin, "post", path + "/cancel", {
        version: corrected.version,
        reason: "Anulación de prueba",
      }).expect(200);
      const events = (await owner.get("/api" + path + "/history").expect(200))
        .body.items;
      assert.equal(
        events.filter((e: { action: string }) => e.action === "CREATED").length,
        1,
      );
      assert.ok(
        events.some(
          (e: {
            action: string;
            before?: { distanceKm: number };
            after?: { distanceKm: number };
          }) =>
            e.action === "UPDATED" &&
            e.before?.distanceKm === 350 &&
            e.after?.distanceKm === 0,
        ),
      );
      assert.equal(
        (
          await oldAdmin
            .get("/api/trips")
            .query({ driverId: base.driverId })
            .expect(200)
        ).body.totals.distanceKm,
        200,
      );
      // A distance-only trip can cross a real odometer correction. Subsequent measured trips
      // still validate against the corrected reading and the truck stays occupied by both methods.
      const adjustment = (
        await write(newAdmin, "patch", "/trucks/" + truck.id + "/odometer", {
          odometer: 600,
          expectedOdometer: 1200,
          expectedOdometerAt: measured.arrivalAt,
        }).expect(200)
      ).body;
      const correctionAt = Date.parse(adjustment.odometerAt);
      const dates = {
        departureAt: new Date(correctionAt - 1000).toISOString(),
        arrivalAt: new Date(correctionAt + 1000).toISOString(),
      };
      const historical = { ...manualPreview, ...dates };
      const across = (
        await write(
          newAdmin,
          "post",
          "/trips/km100-preview",
          historical,
        ).expect(200)
      ).body;
      await write(newAdmin, "post", "/trips", {
        ...manual,
        ...dates,
        clientRequestId: randomUUID(),
        km100: across.suggestedKm ?? 0,
      }).expect(201);
      const next = {
        ...measured,
        departureAt: new Date(correctionAt + 2000).toISOString(),
        arrivalAt: new Date(correctionAt + 3000).toISOString(),
        startKm: 599,
        endKm: 610,
        clientRequestId: randomUUID(),
        km100: 0,
      };
      await write(owner, "post", "/trips", next).expect(409);
      const nextPreview = (
        await write(owner, "post", "/trips/km100-preview", {
          departureAt: next.departureAt,
          arrivalAt: next.arrivalAt,
          startKm: 600,
          endKm: 610,
        }).expect(200)
      ).body;
      await write(owner, "post", "/trips", {
        ...next,
        startKm: 600,
        km100: nextPreview.suggestedKm ?? 0,
      }).expect(201);
    } finally {
      await db.audit.deleteMany({ where: { actorId: { in: userIds } } });
      await db.trip.deleteMany({
        where: { truckId: { in: [truck.id, spare.id] } },
      });
      await db.obligation.delete({ where: { id: obligation.id } });
      await db.trailer.delete({ where: { id: trailer.id } });
      await db.driver.deleteMany({ where: { userId: { in: userIds } } });
      await db.truck.deleteMany({
        where: { id: { in: [truck.id, spare.id] } },
      });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await disconnect();
    }
  },
);

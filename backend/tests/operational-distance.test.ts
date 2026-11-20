import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { OPERATIONAL_DISTANCE_ENABLED } from "../src/operational-distance-enabled.js";
import { resolveFixtureKm100 } from "./km100-fixtures.js";

test(
  "distancia operativa: autorización, primera lectura y vencimientos en ambas etapas",
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
    const userIds: string[] = [];
    const truckIds: string[] = [];
    const account = async (role: "ADMIN" | "DRIVER", prefix: string) => {
      const user = await db.user.create({
        data: {
          username: prefix + suffix,
          name: "Prueba " + prefix,
          role,
          passwordHash,
          mustChangePassword: false,
          ...(role === "DRIVER" && { driver: { create: {} } }),
        },
        include: { driver: true },
      });
      userIds.push(user.id);
      return user;
    };
    const newTruck = async (prefix: string) => {
      const truck = await db.truck.create({
        data: { plate: prefix + suffix, label: "Camión de prueba" },
      });
      truckIds.push(truck.id);
      return truck;
    };
    const origin = getConfig().origin;
    type Client = ReturnType<typeof request.agent>;
    const write = (
      client: Client,
      method: "post" | "patch",
      path: string,
      body: object,
    ) =>
      client[method]("/api" + path)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const login = async (
      app: ReturnType<typeof createApp>,
      username: string,
    ) => {
      const client = request.agent(app);
      await write(client, "post", "/auth/login", { username, password }).expect(
        200,
      );
      return client;
    };
    const at = (hour: number) =>
      new Date(Date.UTC(2025, 6, 16, hour)).toISOString();
    const interval = (hour: number) => ({
      departureAt: at(hour),
      arrivalAt: at(hour + 1),
    });
    try {
      const admin = await account("ADMIN", "admop");
      const driver = await account("DRIVER", "choferop");
      const other = await account("DRIVER", "otroop");
      const truck = await newTruck("OP");
      const spare = await newTruck("SP");
      const obligation = await db.obligation.create({
        data: {
          kind: "SERVICE",
          truckId: truck.id,
          title: "Service de prueba",
          dueKm: 120500,
          warningKm: 200,
        },
      });
      const stageA = createApp({ operationalDistanceEnabled: false });
      const stageB = createApp({ operationalDistanceEnabled: true });
      const oldAdmin = await login(stageA, admin.username);
      const oldDriver = await login(stageA, driver.username);
      const manager = await login(stageB, admin.username);
      const owner = await login(stageB, driver.username);
      const foreign = await login(stageB, other.username);
      const deployedDriver = await login(createApp(), driver.username);
      const maintenance = async (client: Client, truckId: string) => {
        const row = (
          await client.get("/api/trucks").expect(200)
        ).body.items.find((t: { id: string }) => t.id === truckId);
        return [row.odometer, row.maintenanceKm, row.mileageEstimated];
      };
      const remaining = async () =>
        (await manager.get("/api/obligations").expect(200)).body.items.find(
          (o: { id: string }) => o.id === obligation.id,
        ).kmRemaining;
      const preview = {
        ...interval(13),
        mileageMode: "DISTANCE",
        distanceKm: 350,
      };
      const body = {
        ...preview,
        clientRequestId: randomUUID(),
        driverId: driver.driver!.id,
        truckId: truck.id,
        origin: "Rosario",
        destination: "Córdoba",
        km100: 0,
      };
      const initial = { ...body, initialTruckOdometer: 120000 };
      const audits = () =>
        db.audit.count({
          where: {
            entity: "TRUCK",
            entityId: truck.id,
            action: "ODOMETER_INITIALIZED",
          },
        });
      await write(
        deployedDriver,
        "post",
        "/trips/km100-preview",
        preview,
      ).expect(OPERATIONAL_DISTANCE_ENABLED ? 200 : 403);
      await write(oldDriver, "post", "/trips", initial).expect(403);
      await write(oldAdmin, "post", "/trips", {
        ...initial,
        countForMaintenance: true,
      }).expect(409);
      await write(foreign, "post", "/trips", initial).expect(403);
      await write(owner, "post", "/trips", {
        ...initial,
        countForMaintenance: false,
      }).expect(403);
      await write(owner, "post", "/trips", {
        ...initial,
        distanceSource: "ADMIN",
      }).expect(400);
      await write(manager, "post", "/trips", initial).expect(400);
      const needsBase = await write(owner, "post", "/trips", body).expect(400);
      assert.equal(needsBase.body.error.code, "INITIAL_ODOMETER_REQUIRED");
      await write(owner, "post", "/trips", { ...initial, km100: 351 }).expect(
        400,
      );
      assert.equal(await audits(), 0);
      assert.deepEqual(await maintenance(manager, truck.id), [
        null,
        null,
        false,
      ]);

      const direct = (await write(owner, "post", "/trips", initial).expect(201))
        .body;
      assert.deepEqual(
        [
          direct.startKm,
          direct.endKm,
          direct.distanceKm,
          direct.createdById,
          direct.distanceSource,
        ],
        [null, null, 350, driver.id, "DRIVER"],
      );
      const path = "/trips/" + direct.id;
      const firstAudit = await db.audit.findFirstOrThrow({
        where: { entityId: truck.id, action: "ODOMETER_INITIALIZED" },
      });
      assert.equal(firstAudit.actorId, driver.id);
      assert.deepEqual(firstAudit.after, {
        version: 1,
        odometer: 120000,
        odometerAt: at(13),
      });
      await write(owner, "post", "/trips", initial).expect(200);
      await write(oldDriver, "post", "/trips", initial).expect(200);
      await write(owner, "post", "/trips", body).expect(409);
      await write(owner, "post", "/trips", {
        ...initial,
        initialTruckOdometer: 120001,
      }).expect(409);
      await write(manager, "post", "/trips", {
        ...initial,
        countForMaintenance: true,
      }).expect(409);
      assert.equal(await audits(), 1);
      assert.deepEqual(await maintenance(oldAdmin, truck.id), [
        120000,
        120350,
        true,
      ]);
      assert.equal(await remaining(), 150);
      const historical = (
        await write(oldAdmin, "post", "/trips", {
          ...body,
          ...interval(10),
          clientRequestId: randomUUID(),
        }).expect(201)
      ).body;
      assert.equal(historical.distanceSource, null);
      await write(owner, "patch", "/trips/" + historical.id, {
        version: 1,
        notes: "Corrección",
      }).expect(403);
      assert.equal(await remaining(), 150);
      const retro = {
        ...body,
        ...interval(11),
        clientRequestId: randomUUID(),
        distanceKm: 90,
      };
      const retries = await Promise.all([
        write(owner, "post", "/trips", retro),
        write(owner, "post", "/trips", retro),
      ]);
      assert.deepEqual(retries.map((r) => r.status).sort(), [200, 201]);
      assert.equal(retries[0].body.id, retries[1].body.id);
      assert.equal(retries[0].body.distanceSource, "DRIVER");
      assert.equal(await remaining(), 150);
      const extra = (
        await write(manager, "post", "/trips", {
          ...body,
          ...interval(15),
          clientRequestId: randomUUID(),
          countForMaintenance: true,
          distanceKm: 30,
        }).expect(201)
      ).body;
      assert.equal(extra.distanceSource, "ADMIN");
      assert.equal(await remaining(), 120);
      await write(owner, "patch", "/trips/" + extra.id, {
        version: 1,
        distanceKm: 40,
      }).expect(403);
      await write(manager, "post", "/trips/" + extra.id + "/cancel", {
        version: 1,
        reason: "Carga duplicada",
      }).expect(200);
      assert.equal(await remaining(), 150);

      for (const [field, value] of Object.entries({
        countForMaintenance: false,
        initialTruckOdometer: 120000,
        distanceSource: "ADMIN",
        mileageMode: "ODOMETER",
      })) {
        await write(manager, "patch", path, {
          version: 1,
          [field]: value,
        }).expect(400);
      }
      await write(oldDriver, "patch", path, {
        version: 1,
        distanceKm: 340,
      }).expect(403);
      await write(foreign, "patch", path, {
        version: 1,
        distanceKm: 340,
      }).expect(404);
      await write(owner, "patch", path, {
        version: 1,
        truckId: spare.id,
      }).expect(409);
      await write(owner, "patch", path, {
        version: 1,
        distanceKm: 340,
        km100: 0,
      }).expect(200);
      assert.equal(await remaining(), 160);
      await write(owner, "patch", path, {
        version: 1,
        distanceKm: 320,
        km100: 0,
      }).expect(409);
      let latest = (
        await write(owner, "patch", path, {
          version: 2,
          distanceKm: 350,
          km100: 0,
        }).expect(200)
      ).body;
      assert.equal(await remaining(), 150);
      if (latest.km100Context.mode === "PENDING")
        latest = await resolveFixtureKm100(manager, origin, direct.id);
      latest = (
        await write(manager, "post", path + "/review", {
          version: latest.version,
        }).expect(200)
      ).body;
      await write(owner, "patch", path, {
        version: latest.version,
        distanceKm: 340,
      }).expect(403);
      latest = (
        await write(manager, "patch", path, {
          version: latest.version,
          driverId: other.driver!.id,
        }).expect(200)
      ).body;
      await write(owner, "post", "/trips", initial).expect(409);
      await write(foreign, "patch", path, {
        version: latest.version,
        distanceKm: 340,
      }).expect(403);
      const renewal = {
        performedAt: at(14),
        odometer: 120340,
        nextDueKm: 120500,
        version: 1,
      };
      const renewalPath = "/obligations/" + obligation.id + "/renewals";
      const interior = new Date(Date.parse(at(13)) + 30 * 60_000).toISOString();
      await write(manager, "post", renewalPath, {
        ...renewal,
        performedAt: interior,
      }).expect(409);
      await write(manager, "post", renewalPath, renewal).expect(201);
      assert.deepEqual(await maintenance(oldAdmin, truck.id), [
        120340,
        120340,
        false,
      ]);
      assert.equal(await remaining(), 160);
      await write(manager, "post", path + "/cancel", {
        version: latest.version,
        reason: "Prueba",
      }).expect(200);
      assert.equal(await remaining(), 160);

      // Concurrent attempts to initialize one truck produce a single reading, even at zero.
      const seed = {
        ...body,
        ...interval(17),
        truckId: spare.id,
        initialTruckOdometer: 0,
        distanceKm: 5,
      };
      const attempts = await Promise.all(
        [17, 18].map((hour) =>
          write(owner, "post", "/trips", {
            ...seed,
            ...interval(hour),
            clientRequestId: randomUUID(),
          }),
        ),
      );
      assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
      assert.equal(
        attempts.find((r) => r.status === 409)?.body.error.code,
        "INITIAL_ODOMETER_CONFLICT",
      );
      assert.deepEqual(await maintenance(manager, spare.id), [0, 5, true]);
      assert.equal(
        await db.audit.count({
          where: { entityId: spare.id, action: "ODOMETER_INITIALIZED" },
        }),
        1,
      );
      // A measured trip alone can supply the real reading; moving or cancelling it must preserve dependent trips.
      const measuredTruck = await newTruck("ME");
      const measured = (
        await write(owner, "post", "/trips", {
          ...body,
          ...interval(20),
          truckId: measuredTruck.id,
          clientRequestId: randomUUID(),
          mileageMode: "ODOMETER",
          startKm: 100,
          endKm: 130,
          distanceKm: undefined,
        }).expect(201)
      ).body;
      const dependent = (
        await write(owner, "post", "/trips", {
          ...body,
          ...interval(21),
          truckId: measuredTruck.id,
          clientRequestId: randomUUID(),
          distanceKm: 20,
        }).expect(201)
      ).body;
      await write(manager, "post", "/trips/" + measured.id + "/cancel", {
        version: 1,
        reason: "Prueba",
      }).expect(409);
      await write(manager, "patch", "/trips/" + measured.id, {
        version: 1,
        truckId: spare.id,
      }).expect(409);
      await write(owner, "patch", "/trips/" + dependent.id, {
        version: 1,
        truckId: spare.id,
      }).expect(200);
      assert.deepEqual(await maintenance(manager, measuredTruck.id), [
        130,
        130,
        false,
      ]);
      assert.deepEqual(await maintenance(manager, spare.id), [0, 25, true]);
      await write(manager, "post", "/trips/" + measured.id + "/cancel", {
        version: 1,
        reason: "Prueba",
      }).expect(200);
    } finally {
      await db.audit.deleteMany({ where: { actorId: { in: userIds } } });
      await db.renewal.deleteMany({
        where: { obligation: { truckId: { in: truckIds } } },
      });
      await db.obligation.deleteMany({ where: { truckId: { in: truckIds } } });
      await db.trip.deleteMany({ where: { truckId: { in: truckIds } } });
      await db.truck.deleteMany({ where: { id: { in: truckIds } } });
      await db.driver.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await disconnect();
    }
  },
);

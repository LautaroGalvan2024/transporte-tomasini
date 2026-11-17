import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { strFromU8, unzipSync } from "fflate";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "CUIL: formato, permisos, privacidad, concurrencia y conservación del perfil",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      origin = getConfig().origin;
    const password = "Clave-prueba-cuil-aislado-2026",
      passwordHash = await hashPassword(password);
    const prefix = `cuil_${randomUUID().slice(0, 8)}_`,
      ids: string[] = [],
      truckIds: string[] = [];
    const make = async (
      suffix: string,
      role: "ADMIN" | "DRIVER",
      profile: boolean,
      active = true,
    ) => {
      const row = await db.user.create({
        data: {
          username: prefix + suffix,
          name: `CUIL ficticio ${suffix}`,
          role,
          passwordHash,
          active,
          mustChangePassword: false,
          ...(profile ? { driver: { create: {} } } : {}),
        },
        include: { driver: true },
      });
      ids.push(row.id);
      return row;
    };
    try {
      const admin = await make("admin", "ADMIN", false);
      const secondAdmin = await make("admin2", "ADMIN", false);
      const driver = await make("chofer", "DRIVER", true);
      const other = await make("otro", "DRIVER", true);
      const inactive = await make("inactivo", "DRIVER", true, false);
      const inactiveAdmin = await make("admin_inactivo", "ADMIN", false, false);
      const adminAgent = request.agent(app),
        secondAgent = request.agent(app),
        driverAgent = request.agent(app),
        otherAgent = request.agent(app),
        anonymous = request.agent(app);
      const patch = (agent: typeof adminAgent, id: string, body: object) =>
        agent
          .patch(`/api/users/${id}/cuil`)
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1")
          .send(body);
      const login = async (agent: typeof adminAgent, username: string) => {
        const response = await agent
          .post("/api/auth/login")
          .set("Origin", origin)
          .set("X-Tomasini-Request", "1")
          .send({ username, password });
        assert.equal(response.status, 200);
      };
      await login(adminAgent, admin.username);
      await login(secondAgent, secondAdmin.username);
      await login(driverAgent, driver.username);
      await login(otherAgent, other.username);
      const original = {
        cuil: "20-12345678-9",
        expectedUpdatedAt: driver.updatedAt.toISOString(),
      };
      const monthlyStrings = async () => {
        const response = await adminAgent
          .get(
            `/api/trips/export?format=monthly&driverId=${driver.driver!.id}&month=2026-01`,
          )
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            res.on("end", () => done(null, Buffer.concat(chunks)));
          });
        assert.equal(response.status, 200);
        return strFromU8(unzipSync(response.body)["xl/sharedStrings.xml"]);
      };

      await t.test(
        "administración exclusiva, origen y cuerpo estricto",
        async () => {
          assert.equal(
            (await patch(anonymous, driver.id, original)).status,
            401,
          );
          assert.equal(
            (await patch(driverAgent, driver.id, original)).status,
            403,
          );
          assert.equal(
            (await patch(driverAgent, other.id, original)).status,
            403,
          );
          assert.equal(
            (
              await adminAgent
                .patch(`/api/users/${driver.id}/cuil`)
                .send(original)
            ).status,
            403,
          );
          for (const body of [
            {},
            { cuil: null },
            { ...original, cuil: "123" },
            { ...original, cuil: "201234567890" },
            { ...original, cuil: "20.12345678.9" },
            { ...original, cuil: "20A123456789" },
            { ...original, cuil: 20123456789 },
            { ...original, expectedUpdatedAt: "ayer" },
            { ...original, role: "ADMIN" },
            { ...original, driverId: other.driver!.id },
          ])
            assert.equal(
              (await patch(adminAgent, driver.id, body)).status,
              400,
            );
          assert.equal(
            (await patch(adminAgent, randomUUID(), original)).status,
            404,
          );
          assert.equal(
            (
              await db.driver.findUniqueOrThrow({
                where: { id: driver.driver!.id },
              })
            ).cuil,
            null,
          );
        },
      );

      let reference = driver.updatedAt.toISOString();
      await t.test(
        "normaliza, distingue nulo y guarda auditoría sin revocar sesiones",
        async () => {
          const saved = await patch(adminAgent, driver.id, {
            ...original,
            cuil: " 20 - 12345678 - 9 ",
          });
          assert.equal(saved.status, 200);
          assert.equal(saved.body.cuil, "20123456789");
          assert.equal(saved.body.driverId, driver.driver!.id);
          assert.ok(
            new Date(saved.body.updatedAt).getTime() >
              driver.updatedAt.getTime(),
          );
          reference = saved.body.updatedAt;
          const repeated = await patch(adminAgent, driver.id, original);
          assert.equal(repeated.status, 200);
          assert.equal(repeated.body.updatedAt, reference);
          const audits = await db.audit.findMany({
            where: {
              entity: "USER",
              entityId: driver.id,
              action: "CUIL_UPDATED",
            },
          });
          assert.equal(audits.length, 1);
          assert.equal(audits[0].actorId, admin.id);
          assert.deepEqual(audits[0].before, {
            driverId: driver.driver!.id,
            cuil: null,
            updatedAt: driver.updatedAt.toISOString(),
          });
          assert.deepEqual(audits[0].after, {
            driverId: driver.driver!.id,
            cuil: "20123456789",
            updatedAt: reference,
          });
          assert.doesNotMatch(
            JSON.stringify(audits),
            /passwordHash|tokenHash|scrypt\$/,
          );
          assert.equal((await driverAgent.get("/api/auth/me")).status, 200);
          assert.equal(
            (
              await patch(adminAgent, driver.id, {
                ...original,
                cuil: "27123456789",
              })
            ).body.error.code,
            "CUIL_VERSION_CONFLICT",
          );
        },
      );

      await t.test(
        "la exportación mensual usa el CUIL del perfil guardado",
        async () => {
          const truck = await db.truck.create({
            data: {
              plate: `C${randomUUID().replaceAll("-", "").slice(0, 11)}`,
              label: "Camión ficticio CUIL",
            },
          });
          truckIds.push(truck.id);
          await db.trip.create({
            data: {
              clientRequestId: randomUUID(),
              requestHash: "c".repeat(64),
              createdById: admin.id,
              driverId: driver.driver!.id,
              truckId: truck.id,
              origin: "Origen prueba CUIL",
              destination: "Destino prueba CUIL",
              departureAt: new Date("2026-01-10T10:00:00-03:00"),
              arrivalAt: new Date("2026-01-10T11:00:00-03:00"),
              startKm: 0,
              endKm: 10,
            },
          });
          assert.match(await monthlyStrings(), /20-12345678-9/);
          assert.equal(
            (
              await driverAgent.get(
                `/api/trips/export?format=monthly&driverId=${driver.driver!.id}&month=2026-01`,
              )
            ).status,
            403,
          );
        },
      );

      await t.test(
        "CUIL de otros choferes no se divulga al perfil DRIVER",
        async () => {
          assert.equal((await driverAgent.get("/api/users")).status, 403);
          const own = await driverAgent.get("/api/drivers");
          assert.equal(own.status, 200);
          assert.equal(own.body.items.length, 1);
          assert.equal(own.body.items[0].cuil, "20123456789");
          const others = await otherAgent.get("/api/drivers");
          assert.equal(others.body.items.length, 1);
          assert.equal(others.body.items[0].id, other.driver!.id);
          assert.doesNotMatch(JSON.stringify(others.body), /20123456789/);
          assert.equal(
            (await otherAgent.get("/api/auth/me")).body.cuil,
            undefined,
          );
        },
      );

      await t.test("dos ediciones concurrentes no pisan el CUIL", async () => {
        const responses = await Promise.all([
          patch(adminAgent, driver.id, {
            cuil: "27123456789",
            expectedUpdatedAt: reference,
          }),
          patch(secondAgent, driver.id, {
            cuil: "23123456789",
            expectedUpdatedAt: reference,
          }),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [200, 409],
        );
        const winner = responses.find((response) => response.status === 200)!;
        const loser = responses.find((response) => response.status === 409)!;
        assert.equal(loser.body.error.code, "CUIL_VERSION_CONFLICT");
        assert.equal(
          (
            await db.driver.findUniqueOrThrow({
              where: { id: driver.driver!.id },
            })
          ).cuil,
          winner.body.cuil,
        );
        reference = winner.body.updatedAt;
        assert.equal(
          await db.audit.count({
            where: { entityId: driver.id, action: "CUIL_UPDATED" },
          }),
          2,
        );
      });

      await t.test(
        "vacío elimina sólo el dato y conserva perfil e historial",
        async () => {
          const cleared = await patch(adminAgent, driver.id, {
            cuil: "  ",
            expectedUpdatedAt: reference,
          });
          assert.equal(cleared.status, 200);
          assert.equal(cleared.body.cuil, null);
          assert.equal(cleared.body.driverId, driver.driver!.id);
          const strings = await monthlyStrings();
          assert.match(strings, /CUIL:/);
          assert.doesNotMatch(strings, /\d{2}-12345678-9/);
          assert.equal(
            (
              await patch(adminAgent, driver.id, {
                cuil: null,
                expectedUpdatedAt: reference,
              })
            ).status,
            200,
          );
          assert.equal(
            await db.audit.count({
              where: { entityId: driver.id, action: "CUIL_UPDATED" },
            }),
            3,
          );
        },
      );

      await t.test(
        "perfil administrativo opcional y corrección de usuarios inactivos",
        async () => {
          const blank = await patch(adminAgent, admin.id, {
            cuil: null,
            expectedUpdatedAt: admin.updatedAt.toISOString(),
          });
          assert.equal(blank.status, 200);
          assert.equal(blank.body.driverId, null);
          assert.equal(
            await db.driver.count({ where: { userId: admin.id } }),
            0,
          );
          const created = await patch(adminAgent, admin.id, {
            cuil: "24123456789",
            expectedUpdatedAt: admin.updatedAt.toISOString(),
          });
          assert.equal(created.status, 200);
          assert.equal(created.body.role, "ADMIN");
          assert.ok(created.body.driverId);
          assert.equal(created.body.assignedTruckId, null);
          assert.equal((await adminAgent.get("/api/auth/me")).status, 200);
          const again = await patch(adminAgent, admin.id, {
            cuil: "24-12345678-9",
            expectedUpdatedAt: created.body.updatedAt,
          });
          assert.equal(again.body.driverId, created.body.driverId);
          assert.equal(
            await db.driver.count({ where: { userId: admin.id } }),
            1,
          );
          const corrected = await patch(adminAgent, inactive.id, {
            cuil: "25123456789",
            expectedUpdatedAt: inactive.updatedAt.toISOString(),
          });
          assert.equal(corrected.status, 200);
          assert.equal(corrected.body.active, false);
          const rejected = await patch(adminAgent, inactiveAdmin.id, {
            cuil: "26123456789",
            expectedUpdatedAt: inactiveAdmin.updatedAt.toISOString(),
          });
          assert.equal(rejected.body.error.code, "USER_INACTIVE");
          assert.equal(
            await db.driver.count({ where: { userId: inactiveAdmin.id } }),
            0,
          );
        },
      );
    } finally {
      await db.audit.deleteMany({ where: { actorId: { in: ids } } });
      await db.session.deleteMany({ where: { userId: { in: ids } } });
      await db.trip.deleteMany({ where: { truckId: { in: truckIds } } });
      await db.truck.deleteMany({ where: { id: { in: truckIds } } });
      await db.driver.deleteMany({ where: { userId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await disconnect();
    }
  },
);

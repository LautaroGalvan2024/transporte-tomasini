import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getDb, assertDatabaseScope, disconnect } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "invitaciones seguras con PostgreSQL: permisos, caducidad, consumo atómico e historial",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      prefix = `invite_${randomUUID().slice(0, 8)}_`,
      password = "Contraseña-pruebas-larga-2026",
      passwordHash = await hashPassword(password),
      origin = getConfig().origin;
    const admin = await db.user.create({
      data: {
        username: `${prefix}admin`,
        name: "Administración prueba",
        passwordHash,
        role: "ADMIN",
        mustChangePassword: false,
      },
    });
    const existing = await db.user.create({
      data: {
        username: `${prefix}existing`,
        name: "Chofer existente",
        passwordHash,
        role: "DRIVER",
        mustChangePassword: false,
        driver: { create: {} },
      },
      include: { driver: true },
    });
    const truck = await db.truck.create({
      data: {
        plate: `I${randomUUID().slice(0, 8).toUpperCase()}`,
        label: "Invitación histórica",
        initialOdometer: 1000,
        initialOdometerAt: new Date(Date.now() - 10 * 86_400_000),
      },
    });
    await db.driver.update({
      where: { id: existing.driver!.id },
      data: { assignedTruckId: truck.id },
    });
    const historical = await db.trip.create({
      data: {
        clientRequestId: randomUUID(),
        requestHash: "a".repeat(64),
        createdById: existing.id,
        driverId: existing.driver!.id,
        truckId: truck.id,
        origin: "Rosario",
        destination: "Córdoba",
        departureAt: new Date(Date.now() - 9 * 86_400_000),
        arrivalAt: new Date(Date.now() - 9 * 86_400_000 + 3_600_000),
        startKm: 1000,
        endKm: 1200,
      },
    });
    const adminAgent = request.agent(app),
      driverAgent = request.agent(app),
      publicAgent = request.agent(app);
    const post = (agent: typeof adminAgent, path: string, body: object = {}) =>
      agent
        .post(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const patch = (path: string, body: object) =>
      adminAgent
        .patch(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const tokenValues: string[] = [];
    async function create(body: object) {
      const result = await post(adminAgent, "/invitations", body);
      assert.equal(result.status, 201, result.body.error?.code);
      assert.ok(
        typeof result.body.token === "string" &&
          /^[A-Za-z0-9_-]{43}$/.test(result.body.token),
      );
      assert.ok(
        result.body.joinUrl.startsWith(`${origin}/join#`) &&
          !result.body.joinUrl.includes("?"),
      );
      tokenValues.push(result.body.token);
      return result.body as {
        invitation: { id: string; expiresAt: string; status: string };
        token: string;
        joinUrl: string;
      };
    }
    const acceptance = (token: string, username: string) => ({
      token,
      name: "Persona invitada",
      username,
      password,
    });
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
            username: existing.username,
            password,
          })
        ).status,
        200,
      );
      await t.test(
        "sin autorregistro abierto y creación/listado/revocación exclusivos de administración",
        async () => {
          assert.equal((await publicAgent.get("/api/invitations")).status, 401);
          assert.equal(
            (await post(publicAgent, "/invitations", { role: "ADMIN" })).status,
            401,
          );
          assert.equal((await driverAgent.get("/api/invitations")).status, 403);
          assert.equal(
            (await post(driverAgent, "/invitations", { role: "ADMIN" })).status,
            403,
          );
          assert.equal(
            (
              await post(
                publicAgent,
                "/invitations/accept",
                acceptance(
                  randomBytes(32).toString("base64url"),
                  `${prefix}invalid`,
                ),
              )
            ).status,
            404,
          );
          assert.equal(
            (
              await publicAgent
                .post("/api/invitations/preview")
                .send({ token: randomBytes(32).toString("base64url") })
            ).status,
            403,
          );
          assert.equal(
            (
              await post(adminAgent, "/invitations", {
                role: "ADMIN",
                driverId: existing.driver!.id,
              })
            ).status,
            400,
          );
        },
      );
      await t.test(
        "token de un solo uso, rol fijado, usuario duplicado no consume invitación y aceptación no abre sesión",
        async () => {
          const invitation = await create({
            role: "DRIVER",
            name: "Nuevo chofer",
            expiresInDays: 7,
          });
          const preview = await post(publicAgent, "/invitations/preview", {
            token: invitation.token,
          });
          assert.equal(preview.status, 200);
          assert.equal(preview.body.role, "DRIVER");
          assert.equal(preview.body.replacesExistingAccess, false);
          const row = await db.invitation.findUniqueOrThrow({
            where: { id: invitation.invitation.id },
          });
          assert.ok(
            row.tokenHash !== invitation.token &&
              /^[a-f0-9]{64}$/.test(row.tokenHash),
          );
          assert.equal(
            (
              await post(publicAgent, "/invitations/accept", {
                ...acceptance(invitation.token, `${prefix}new`),
                role: "ADMIN",
              })
            ).status,
            400,
          );
          const duplicate = await post(
            publicAgent,
            "/invitations/accept",
            acceptance(invitation.token, admin.username),
          );
          assert.equal(duplicate.status, 409);
          assert.equal(duplicate.body.error.code, "USERNAME_TAKEN");
          assert.equal(
            (
              await post(publicAgent, "/invitations/preview", {
                token: invitation.token,
              })
            ).status,
            200,
          );
          const accepted = await post(
            publicAgent,
            "/invitations/accept",
            acceptance(invitation.token, `${prefix}new`),
          );
          assert.equal(accepted.status, 201);
          assert.equal(accepted.body.role, "DRIVER");
          assert.equal(accepted.headers["set-cookie"], undefined);
          const account = await db.user.findUniqueOrThrow({
            where: { username: `${prefix}new` },
            include: { driver: true },
          });
          assert.equal(account.mustChangePassword, false);
          assert.ok(account.driver);
          assert.equal((await publicAgent.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(
                publicAgent,
                "/invitations/accept",
                acceptance(invitation.token, `${prefix}again`),
              )
            ).status,
            410,
          );
          assert.equal(
            (
              await post(
                driverAgent,
                `/invitations/${invitation.invitation.id}/revoke`,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await post(
                adminAgent,
                `/invitations/${invitation.invitation.id}/revoke`,
              )
            ).status,
            409,
          );
        },
      );
      await t.test("vencimiento y revocación invalidan enlaces", async () => {
        const expired = await create({ role: "DRIVER", expiresInDays: 1 });
        await db.invitation.update({
          where: { id: expired.invitation.id },
          data: {
            createdAt: new Date(Date.now() - 3 * 86_400_000),
            expiresAt: new Date(Date.now() - 86_400_000),
          },
        });
        assert.equal(
          (
            await post(
              publicAgent,
              "/invitations/accept",
              acceptance(expired.token, `${prefix}expired`),
            )
          ).status,
          410,
        );
        const revoked = await create({ role: "ADMIN" });
        assert.equal(
          (
            await post(
              adminAgent,
              `/invitations/${revoked.invitation.id}/revoke`,
            )
          ).body.status,
          "REVOKED",
        );
        assert.equal(
          (
            await post(
              publicAgent,
              "/invitations/accept",
              acceptance(revoked.token, `${prefix}revoked`),
            )
          ).status,
          410,
        );
      });
      await t.test(
        "invitación administrativa crea administración sin entidad chofer",
        async () => {
          const invitation = await create({ role: "ADMIN" });
          assert.equal(
            (
              await post(
                publicAgent,
                "/invitations/accept",
                acceptance(invitation.token, `${prefix}newadmin`),
              )
            ).status,
            201,
          );
          const account = await db.user.findUniqueOrThrow({
            where: { username: `${prefix}newadmin` },
            include: { driver: true },
          });
          assert.equal(account.role, "ADMIN");
          assert.equal(account.driver, null);
          assert.equal(account.mustChangePassword, false);
        },
      );
      await t.test(
        "reemplazo de enlace y aceptación concurrente preservan chofer, camión, viajes y revocan sesiones",
        async () => {
          const old = await create({
            role: "DRIVER",
            driverId: existing.driver!.id,
          });
          const invitation = await create({
            role: "DRIVER",
            driverId: existing.driver!.id,
          });
          assert.equal(
            (
              await post(publicAgent, "/invitations/preview", {
                token: old.token,
              })
            ).status,
            410,
          );
          assert.equal(
            (
              await post(
                publicAgent,
                "/invitations/accept",
                acceptance(old.token, `${prefix}old`),
              )
            ).status,
            410,
          );
          assert.equal(
            (
              await db.invitation.findUniqueOrThrow({
                where: { id: old.invitation.id },
              })
            ).revokedById,
            admin.id,
          );
          const preview = await post(publicAgent, "/invitations/preview", {
            token: invitation.token,
          });
          assert.equal(preview.body.replacesExistingAccess, true);
          const results = await Promise.all([
            post(
              publicAgent,
              "/invitations/accept",
              acceptance(invitation.token, `${prefix}linked`),
            ),
            post(
              publicAgent,
              "/invitations/accept",
              acceptance(invitation.token, `${prefix}linked`),
            ),
          ]);
          assert.deepEqual(results.map((r) => r.status).sort(), [201, 410]);
          const linked = await db.driver.findUniqueOrThrow({
            where: { id: existing.driver!.id },
            include: { user: true },
          });
          assert.equal(linked.userId, existing.id);
          assert.equal(linked.assignedTruckId, truck.id);
          assert.equal(linked.user.username, `${prefix}linked`);
          assert.equal(
            (await db.trip.findUniqueOrThrow({ where: { id: historical.id } }))
              .driverId,
            existing.driver!.id,
          );
          assert.equal((await driverAgent.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(driverAgent, "/auth/login", {
                username: `${prefix}linked`,
                password,
              })
            ).status,
            200,
          );
          assert.equal(
            (await driverAgent.get(`/api/trips/${historical.id}`)).status,
            200,
          );
        },
      );
      await t.test(
        "crear un enlace mientras se acepta el anterior deja un único enlace pendiente",
        async () => {
          const old = await create({
            role: "DRIVER",
            driverId: existing.driver!.id,
          });
          const [replacement, accepted] = await Promise.all([
            create({ role: "DRIVER", driverId: existing.driver!.id }),
            post(
              publicAgent,
              "/invitations/accept",
              acceptance(old.token, `${prefix}raced`),
            ),
          ]);
          assert.ok([201, 410].includes(accepted.status));
          assert.equal(
            (
              await post(publicAgent, "/invitations/preview", {
                token: old.token,
              })
            ).status,
            410,
          );
          assert.equal(
            (
              await post(publicAgent, "/invitations/preview", {
                token: replacement.token,
              })
            ).status,
            200,
          );
          assert.equal(
            await db.invitation.count({
              where: {
                driverId: existing.driver!.id,
                acceptedAt: null,
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            }),
            1,
          );
          assert.equal(
            (
              await db.driver.findUniqueOrThrow({
                where: { id: existing.driver!.id },
              })
            ).userId,
            existing.id,
          );
        },
      );
      await t.test(
        "baja y restablecimiento de contraseña revocan enlaces y quedan auditados sin tokens",
        async () => {
          const invitation = await create({
            role: "DRIVER",
            driverId: existing.driver!.id,
          });
          assert.equal(
            (await patch(`/drivers/${existing.driver!.id}`, { active: false }))
              .status,
            200,
          );
          assert.equal(
            (
              await post(publicAgent, "/invitations/preview", {
                token: invitation.token,
              })
            ).status,
            410,
          );
          assert.equal(
            (
              await post(adminAgent, "/invitations", {
                role: "DRIVER",
                driverId: existing.driver!.id,
              })
            ).status,
            400,
          );
          assert.equal(
            (await patch(`/drivers/${existing.driver!.id}`, { active: true }))
              .status,
            200,
          );
          const reset = await create({
            role: "DRIVER",
            driverId: existing.driver!.id,
          });
          assert.equal(
            (
              await post(
                adminAgent,
                `/drivers/${existing.driver!.id}/password`,
                { password: "Nueva-provisoria-larga" },
              )
            ).status,
            204,
          );
          assert.equal(
            (
              await post(publicAgent, "/invitations/preview", {
                token: reset.token,
              })
            ).status,
            410,
          );
          const list = await adminAgent.get(
            "/api/invitations?page=1&pageSize=2",
          );
          assert.equal(list.status, 200);
          assert.equal(list.body.items.length, 2);
          assert.ok(list.body.total > 2);
          const audits = await db.audit.findMany({
            where: {
              entity: "INVITATION",
              OR: [{ actorId: admin.id }, { actorId: existing.id }],
            },
          });
          const exposed = JSON.stringify({ list: list.body, audits });
          for (const token of tokenValues) assert.ok(!exposed.includes(token));
          assert.ok(!exposed.includes("tokenHash"));
          assert.ok(audits.some((a) => a.action === "REVOKED"));
        },
      );
      await t.test(
        "aceptación pública limita intentos antes de trabajo costoso",
        async () => {
          const result = await post(
            publicAgent,
            "/invitations/accept",
            acceptance(
              randomBytes(32).toString("base64url"),
              `${prefix}limited`,
            ),
          );
          assert.equal(result.status, 429);
          assert.equal(result.body.error.code, "RATE_LIMIT");
        },
      );
    } finally {
      const accounts = await db.user.findMany({
        where: {
          OR: [{ username: { startsWith: prefix } }, { id: existing.id }],
        },
        select: { id: true },
      });
      const ids = accounts.map((a) => a.id);
      await db.audit.deleteMany({ where: { actorId: { in: ids } } });
      await db.invitation.deleteMany({ where: { createdById: admin.id } });
      await db.trip.deleteMany({ where: { truckId: truck.id } });
      await db.session.deleteMany({ where: { userId: { in: ids } } });
      await db.driver.deleteMany({ where: { userId: { in: ids } } });
      await db.truck.delete({ where: { id: truck.id } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await disconnect();
    }
  },
);

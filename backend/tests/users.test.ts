import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { assertDatabaseScope, disconnect, getDb } from "../src/db.js";
import { getConfig, validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "usuarios: roles, baja lógica, sesiones y protección administrativa concurrente",
  { skip: !enabled, timeout: 120_000 },
  async (t) => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb(),
      app = createApp(),
      origin = getConfig().origin;
    const prefix = `users_${randomUUID().slice(0, 8)}_`,
      password = "Clave-de-pruebas-usuarios-2026";
    const passwordHash = await hashPassword(password);
    const accounts = [];
    for (const [suffix, role] of [
      ["a", "ADMIN"],
      ["b", "ADMIN"],
      ["d", "DRIVER"],
    ] as const) {
      accounts.push(
        await db.user.create({
          data: {
            username: prefix + suffix,
            name: `Fixture ${suffix}`,
            role,
            passwordHash,
            mustChangePassword: false,
            ...(role === "DRIVER" ? { driver: { create: {} } } : {}),
          },
          include: { driver: true },
        }),
      );
    }
    const [a, b, d] = accounts,
      ids = accounts.map((u) => u.id);
    const driverId = d.driver!.id;
    const truck = await db.truck.create({
      data: {
        plate: `U${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        label: "Historial de usuarios",
        initialOdometer: 100,
        initialOdometerAt: new Date(Date.now() - 3 * 3600_000),
      },
    });
    await db.driver.update({
      where: { id: driverId },
      data: { assignedTruckId: truck.id },
    });
    const trip = await db.trip.create({
      data: {
        clientRequestId: randomUUID(),
        requestHash: "a".repeat(64),
        createdById: d.id,
        driverId,
        truckId: truck.id,
        origin: "Origen",
        destination: "Destino",
        departureAt: new Date(Date.now() - 2 * 3600_000),
        arrivalAt: new Date(Date.now() - 3600_000),
        startKm: 100,
        endKm: 120,
      },
    });
    const agentA = request.agent(app),
      agentB = request.agent(app),
      agentD = request.agent(app),
      anonymous = request.agent(app);
    const post = (agent: typeof agentA, path: string, body: object) =>
      agent
        .post(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const patch = (agent: typeof agentA, path: string, body: object) =>
      agent
        .patch(`/api${path}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1")
        .send(body);
    const remove = (agent: typeof agentA, id: string) =>
      agent
        .delete(`/api/users/${id}`)
        .set("Origin", origin)
        .set("X-Tomasini-Request", "1");
    async function login(agent: typeof agentA, id: string) {
      const account = await db.user.findUniqueOrThrow({ where: { id } });
      const response = await post(agent, "/auth/login", {
        username: account.username,
        password,
      });
      assert.equal(response.status, 200);
      return response;
    }
    try {
      await login(agentA, a.id);
      await login(agentB, b.id);
      await login(agentD, d.id);
      await t.test(
        "lista también administradores sin perfil y exige rol, origen y campos permitidos",
        async () => {
          assert.equal((await anonymous.get("/api/users")).status, 401);
          assert.equal((await agentD.get("/api/users")).status, 403);
          assert.equal(
            (await patch(agentD, `/users/${b.id}`, { role: "DRIVER" })).status,
            403,
          );
          assert.equal(
            (await agentA.patch(`/api/users/${d.id}`).send({ active: false }))
              .status,
            403,
          );
          assert.equal(
            (
              await patch(agentA, `/users/${d.id}`, {
                passwordHash: "not-accepted",
              })
            ).status,
            400,
          );
          assert.equal((await patch(agentA, `/users/${d.id}`, {})).status, 400);
          const result = await agentA.get("/api/users");
          assert.equal(result.status, 200);
          const bare = result.body.items.find(
            (u: { id: string }) => u.id === b.id,
          );
          assert.equal(bare.driverId, null);
          assert.equal(bare.role, "ADMIN");
          assert.ok(bare.createdAt && bare.updatedAt);
          assert.doesNotMatch(
            JSON.stringify(result.body),
            /passwordHash|tokenHash/,
          );
          assert.equal(
            (await remove(agentA, a.id)).body.error.code,
            "SELF_ACCESS_CHANGE",
          );
          assert.equal(
            (await patch(agentA, `/users/${a.id}`, { role: "DRIVER" })).body
              .error.code,
            "SELF_ACCESS_CHANGE",
          );
        },
      );
      await t.test(
        "promoción conserva identidad e historial, desasigna camión y cierra accesos anteriores",
        async () => {
          const invitation = await post(agentA, "/invitations", {
            role: "DRIVER",
            driverId,
          });
          assert.equal(invitation.status, 201);
          const promoted = await patch(agentA, `/users/${d.id}`, {
            role: "ADMIN",
          });
          assert.equal(promoted.status, 200);
          assert.equal(promoted.body.driverId, driverId);
          assert.equal(promoted.body.role, "ADMIN");
          assert.equal((await agentD.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(anonymous, "/invitations/preview", {
                token: invitation.body.token,
              })
            ).status,
            410,
          );
          const drivers = await agentA.get("/api/drivers");
          const historical = drivers.body.items.find(
            (row: { id: string }) => row.id === driverId,
          );
          assert.equal(historical.role, "ADMIN");
          assert.equal(historical.accountActive, true);
          assert.equal(historical.active, false);
          assert.equal(historical.assignedTruckId, null);
          assert.equal(
            (await patch(agentA, `/drivers/${driverId}`, { active: false }))
              .body.error.code,
            "DRIVER_ROLE_REQUIRED",
          );
          assert.equal(
            (await post(agentA, `/drivers/${driverId}/password`, { password }))
              .body.error.code,
            "DRIVER_ROLE_REQUIRED",
          );
          await login(agentD, d.id);
          assert.equal((await agentD.get("/api/users")).status, 200);
          assert.equal((await agentD.get(`/api/trips/${trip.id}`)).status, 200);
          assert.equal(
            (await db.trip.findUniqueOrThrow({ where: { id: trip.id } }))
              .driverId,
            driverId,
          );
        },
      );
      await t.test(
        "volver a chofer reutiliza el perfil; baja y reactivación no borran viajes ni restauran sesiones",
        async () => {
          const demoted = await patch(agentA, `/users/${d.id}`, {
            role: "DRIVER",
          });
          assert.equal(demoted.status, 200);
          assert.equal(demoted.body.driverId, driverId);
          assert.equal((await agentD.get("/api/auth/me")).status, 401);
          await login(agentD, d.id);
          assert.equal(
            (
              await patch(agentA, `/drivers/${driverId}`, {
                assignedTruckId: truck.id,
              })
            ).status,
            200,
          );
          const off = await remove(agentA, d.id);
          assert.equal(off.status, 200);
          assert.equal(off.body.active, false);
          assert.equal((await agentD.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(agentD, "/auth/login", {
                username: d.username,
                password,
              })
            ).status,
            401,
          );
          assert.equal(
            (await db.driver.findUniqueOrThrow({ where: { id: driverId } }))
              .assignedTruckId,
            null,
          );
          assert.equal((await remove(agentA, d.id)).status, 200);
          assert.equal(
            await db.audit.count({
              where: { entity: "USER", entityId: d.id, action: "DEACTIVATED" },
            }),
            1,
          );
          assert.equal(
            (await patch(agentA, `/users/${d.id}`, { active: true })).status,
            200,
          );
          assert.equal((await agentD.get("/api/auth/me")).status, 401);
          await login(agentD, d.id);
          assert.equal((await agentD.get(`/api/trips/${trip.id}`)).status, 200);
        },
      );
      await t.test(
        "administrador sin perfil pasa a chofer y revoca invitaciones que había emitido",
        async () => {
          const issued = await post(agentB, "/invitations", {
            role: "ADMIN",
            name: "Pendiente",
          });
          assert.equal(issued.status, 201);
          const changed = await patch(agentA, `/users/${b.id}`, {
            role: "DRIVER",
          });
          assert.equal(changed.status, 200);
          assert.ok(changed.body.driverId);
          assert.equal((await agentB.get("/api/auth/me")).status, 401);
          assert.equal(
            (
              await post(anonymous, "/invitations/preview", {
                token: issued.body.token,
              })
            ).status,
            410,
          );
          assert.equal(
            (
              await db.invitation.findUniqueOrThrow({
                where: { id: issued.body.invitation.id },
              })
            ).revokedById,
            a.id,
          );
          const restored = await patch(agentA, `/users/${b.id}`, {
            role: "ADMIN",
          });
          assert.equal(restored.status, 200);
          assert.equal(restored.body.driverId, changed.body.driverId);
          await login(agentB, b.id);
        },
      );
      await t.test(
        "aceptación concurrente de enlace nunca recupera el rol anterior ni deja accesos pendientes",
        async () => {
          const invitation = await post(agentA, "/invitations", {
            role: "DRIVER",
            driverId,
          });
          assert.equal(invitation.status, 201);
          const [change, accept] = await Promise.all([
            patch(agentA, `/users/${d.id}`, { role: "ADMIN" }),
            post(anonymous, "/invitations/accept", {
              token: invitation.body.token,
              name: "Nombre actualizado",
              username: prefix + "accepted",
              password,
            }),
          ]);
          assert.equal(change.status, 200);
          assert.ok(
            [201, 410].includes(accept.status),
            `Estado concurrente inesperado: ${accept.status}`,
          );
          assert.equal(
            (await db.user.findUniqueOrThrow({ where: { id: d.id } })).role,
            "ADMIN",
          );
          assert.equal(
            await db.invitation.count({
              where: {
                driverId,
                acceptedAt: null,
                revokedAt: null,
                expiresAt: { gt: new Date() },
              },
            }),
            0,
          );
          assert.equal(
            (await patch(agentA, `/users/${d.id}`, { role: "DRIVER" })).status,
            200,
          );
        },
      );
      await t.test(
        "auditorías identifican actor y fecha sin contraseñas, hashes ni tokens",
        async () => {
          const audits = await db.audit.findMany({
            where: { entity: "USER", entityId: { in: ids } },
          });
          assert.ok(audits.some((entry) => entry.action === "ROLE_CHANGED"));
          assert.ok(audits.some((entry) => entry.action === "DEACTIVATED"));
          assert.ok(audits.some((entry) => entry.action === "REACTIVATED"));
          assert.ok(
            audits.every(
              (entry) =>
                entry.actorId === a.id && entry.createdAt instanceof Date,
            ),
          );
          assert.doesNotMatch(
            JSON.stringify(audits),
            /passwordHash|tokenHash|scrypt\$/,
          );
        },
      );
      await t.test(
        "dos administradores no pueden darse de baja mutuamente y dejar la operación sin administración",
        async () => {
          const results = await Promise.all([
            remove(agentA, b.id),
            remove(agentB, a.id),
          ]);
          assert.equal(
            results.filter((result) => result.status === 200).length,
            1,
          );
          assert.ok(
            results.every((result) =>
              [200, 401, 403, 409].includes(result.status),
            ),
          );
          const remaining = await db.user.findMany({
            where: { id: { in: [a.id, b.id] }, role: "ADMIN", active: true },
          });
          assert.equal(remaining.length, 1);
          const survivingAgent = remaining[0].id === a.id ? agentA : agentB;
          assert.equal(
            (await remove(survivingAgent, remaining[0].id)).body.error.code,
            "SELF_ACCESS_CHANGE",
          );
          assert.equal(
            (
              await patch(survivingAgent, `/users/${remaining[0].id}`, {
                role: "DRIVER",
              })
            ).body.error.code,
            "SELF_ACCESS_CHANGE",
          );
        },
      );
    } finally {
      await db.audit.deleteMany({ where: { actorId: { in: ids } } });
      await db.invitation.deleteMany({ where: { createdById: { in: ids } } });
      await db.trip.deleteMany({ where: { truckId: truck.id } });
      await db.session.deleteMany({ where: { userId: { in: ids } } });
      await db.driver.deleteMany({ where: { userId: { in: ids } } });
      await db.truck.delete({ where: { id: truck.id } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await disconnect();
    }
  },
);

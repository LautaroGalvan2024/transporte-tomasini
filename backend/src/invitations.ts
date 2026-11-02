import { Router } from "express";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getDb, transaction, type Tx } from "./db.js";
import { currentUser, requireAdmin, throttle } from "./auth.js";
import { getConfig } from "./config.js";
import { ensure, AppError } from "./errors.js";
import { audit } from "./models.js";
import { hashPassword } from "./password.js";
import { uuid } from "./validation.js";
import { assertAdminAccess, lockAccessChanges } from "./access-control.js";
import {
  invitationAccept,
  invitationCreate,
  invitationPreview,
  invitationQuery,
  invitationStatus,
  invitationTokenHash,
} from "./invitation-domain.js";

const invitationInclude = {
  createdBy: { select: { name: true } },
  driver: {
    include: { user: { select: { name: true, active: true, role: true } } },
  },
} satisfies Prisma.InvitationInclude;
type InvitationRow = Prisma.InvitationGetPayload<{
  include: typeof invitationInclude;
}>;
function invitationDto(row: InvitationRow) {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    driverId: row.driverId,
    driverName: row.driver?.user.name ?? null,
    createdByName: row.createdBy.name,
    status: invitationStatus(row),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
function assertAvailable(
  row: InvitationRow | null,
): asserts row is InvitationRow {
  ensure(
    row,
    404,
    "El enlace de invitación no es válido.",
    "INVITATION_UNAVAILABLE",
  );
  ensure(
    invitationStatus(row) === "PENDING" &&
      (!row.driver ||
        (row.driver.user.active && row.driver.user.role === "DRIVER")),
    410,
    "Este enlace venció, ya se usó o fue cancelado. Pedile uno nuevo a administración.",
    "INVITATION_UNAVAILABLE",
  );
}

export async function revokeDriverInvitations(
  tx: Tx,
  driverId: string,
  actorId: string,
  reason: string,
  exceptId?: string,
) {
  const pending = await tx.invitation.findMany({
    where: {
      driverId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    include: invitationInclude,
  });
  for (const old of pending) {
    const row = await tx.invitation.update({
      where: { id: old.id },
      data: { revokedAt: new Date(), revokedById: actorId },
      include: invitationInclude,
    });
    await audit(
      tx,
      actorId,
      "INVITATION",
      row.id,
      "REVOKED",
      invitationDto(old),
      invitationDto(row),
      reason,
    );
  }
}

export async function revokeIssuedInvitations(
  tx: Tx,
  creatorId: string,
  actorId: string,
  reason: string,
) {
  const pending = await tx.invitation.findMany({
    where: {
      createdById: creatorId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: invitationInclude,
  });
  for (const old of pending) {
    const row = await tx.invitation.update({
      where: { id: old.id },
      data: { revokedAt: new Date(), revokedById: actorId },
      include: invitationInclude,
    });
    await audit(
      tx,
      actorId,
      "INVITATION",
      row.id,
      "REVOKED",
      invitationDto(old),
      invitationDto(row),
      reason,
    );
  }
}

export function publicInvitationsRouter() {
  const router = Router();
  router.post("/preview", async (req, res) => {
    throttle(`invite-preview:${req.ip}`, 60);
    const { token } = invitationPreview.parse(req.body);
    const invitation = await getDb().invitation.findUnique({
      where: { tokenHash: invitationTokenHash(token) },
      include: invitationInclude,
    });
    assertAvailable(invitation);
    res.json({
      role: invitation.role,
      name: invitation.name,
      driverName: invitation.driver?.user.name ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
      replacesExistingAccess: Boolean(invitation.driverId),
    });
  });
  router.post("/accept", async (req, res) => {
    throttle(`invite-accept:${req.ip}`, 12);
    const input = invitationAccept.parse(req.body);
    const tokenHash = invitationTokenHash(input.token);
    const initial = await getDb().invitation.findUnique({
      where: { tokenHash },
      include: invitationInclude,
    });
    assertAvailable(initial);
    // Expensive password work is bounded and only runs after a valid invitation lookup.
    const passwordHash = await hashPassword(input.password);
    try {
      const role = await transaction(async (tx) => {
        await lockAccessChanges(tx);
        // Same lock order as invitation replacement and driver management.
        if (initial.driverId)
          await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${initial.driverId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM tomasini."Invitation" WHERE id = ${initial.id}::uuid FOR UPDATE`;
        const invitation = await tx.invitation.findUnique({
          where: { tokenHash },
          include: invitationInclude,
        });
        assertAvailable(invitation);
        let account;
        if (invitation.driverId) {
          const driver = await tx.driver.findUniqueOrThrow({
            where: { id: invitation.driverId },
            include: { user: true },
          });
          ensure(
            driver.user.active &&
              driver.user.role === "DRIVER" &&
              invitation.role === "DRIVER",
            410,
            "La invitación ya no está disponible.",
            "INVITATION_UNAVAILABLE",
          );
          account = await tx.user.update({
            where: { id: driver.userId },
            data: {
              name: input.name,
              username: input.username,
              passwordHash,
              mustChangePassword: false,
            },
          });
          await tx.session.deleteMany({ where: { userId: account.id } });
          await audit(
            tx,
            account.id,
            "DRIVER",
            driver.id,
            "ACCESS_ACCEPTED",
            { name: driver.user.name, username: driver.user.username },
            { name: account.name, username: account.username },
          );
          await revokeDriverInvitations(
            tx,
            driver.id,
            account.id,
            "Acceso aceptado con otro enlace.",
            invitation.id,
          );
        } else {
          account = await tx.user.create({
            data: {
              name: input.name,
              username: input.username,
              passwordHash,
              role: invitation.role,
              mustChangePassword: false,
              ...(invitation.role === "DRIVER"
                ? { driver: { create: {} } }
                : {}),
            },
          });
        }
        const accepted = await tx.invitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date(), acceptedById: account.id },
          include: invitationInclude,
        });
        await audit(
          tx,
          account.id,
          "INVITATION",
          invitation.id,
          "ACCEPTED",
          invitationDto(invitation),
          invitationDto(accepted),
        );
        return invitation.role;
      });
      // Account activation never starts or replaces a browser session automatically.
      res.status(201).json({ accepted: true, role });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      )
        throw new AppError(
          409,
          "Ese nombre de usuario ya está ocupado. Elegí otro; tu invitación sigue disponible.",
          "USERNAME_TAKEN",
          { username: "Este usuario ya está en uso." },
        );
      throw error;
    }
  });
  return router;
}

export function invitationsRouter() {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (req, res) => {
    const { page, pageSize } = invitationQuery.parse(req.query);
    const [rows, total] = await getDb().$transaction(
      [
        getDb().invitation.findMany({
          include: invitationInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        getDb().invitation.count(),
      ],
      { isolationLevel: "RepeatableRead" },
    );
    res.json({ items: rows.map(invitationDto), total, page, pageSize });
  });
  router.post("/", async (req, res) => {
    const input = invitationCreate.parse(req.body),
      actor = currentUser(req);
    const token = randomBytes(32).toString("base64url");
    const invitation = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      if (input.driverId) {
        await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${input.driverId}::uuid FOR UPDATE`;
        const driver = await tx.driver.findUnique({
          where: { id: input.driverId },
          include: { user: true },
        });
        ensure(
          driver && driver.user.active && driver.user.role === "DRIVER",
          400,
          "Seleccioná un chofer activo para vincular su acceso.",
        );
        await revokeDriverInvitations(
          tx,
          driver.id,
          actor.id,
          "Reemplazada por una invitación nueva.",
        );
      }
      const createdAt = new Date();
      const row = await tx.invitation.create({
        data: {
          tokenHash: invitationTokenHash(token),
          role: input.role,
          name: input.name ?? null,
          driverId: input.driverId ?? null,
          createdById: actor.id,
          createdAt,
          expiresAt: new Date(
            createdAt.getTime() + input.expiresInDays * 86_400_000,
          ),
        },
        include: invitationInclude,
      });
      await audit(
        tx,
        actor.id,
        "INVITATION",
        row.id,
        "CREATED",
        undefined,
        invitationDto(row),
      );
      return row;
    });
    res.status(201).json({
      invitation: invitationDto(invitation),
      token,
      joinUrl: `${getConfig().origin}/join#${token}`,
    });
  });
  router.post("/:id/revoke", async (req, res) => {
    const id = uuid.parse(req.params.id),
      actor = currentUser(req);
    const row = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, actor.id, req.sessionId);
      await tx.$queryRaw`SELECT id FROM tomasini."Invitation" WHERE id = ${id}::uuid FOR UPDATE`;
      const old = await tx.invitation.findUnique({
        where: { id },
        include: invitationInclude,
      });
      ensure(old, 404, "No se encontró la invitación.");
      ensure(
        !old.acceptedAt,
        409,
        "Esta invitación ya fue aceptada. No puede revocarse.",
        "INVITATION_ALREADY_ACCEPTED",
      );
      if (old.revokedAt) return old;
      const updated = await tx.invitation.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: actor.id },
        include: invitationInclude,
      });
      await audit(
        tx,
        actor.id,
        "INVITATION",
        id,
        "REVOKED",
        invitationDto(old),
        invitationDto(updated),
      );
      return updated;
    });
    res.json(invitationDto(row));
  });
  return router;
}

import { Router } from "express";
import { z } from "zod";
import { currentUser, requireAdmin, userDto, type AuthUser } from "./auth.js";
import { getDb, transaction } from "./db.js";
import { assertAdminAccess, lockAccessChanges } from "./access-control.js";
import { ensure } from "./errors.js";
import { uuid } from "./validation.js";
import { audit } from "./models.js";
import {
  revokeDriverInvitations,
  revokeIssuedInvitations,
} from "./invitations.js";

const userUpdate = z
  .object({
    role: z.enum(["ADMIN", "DRIVER"]).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((input) => input.role !== undefined || input.active !== undefined, {
    message: "Indicá el rol o estado que querés cambiar.",
  });

function accessDto(user: AuthUser) {
  return {
    ...userDto(user),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function usersRouter() {
  const router = Router();
  router.use(requireAdmin);
  router.get("/", async (_req, res) => {
    const rows = await getDb().user.findMany({
      include: { driver: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    res.json({ items: rows.map(accessDto) });
  });
  const change =
    (deactivate: boolean) =>
    async (req: import("express").Request, res: import("express").Response) => {
      const id = uuid.parse(req.params.id);
      const input = deactivate ? { active: false } : userUpdate.parse(req.body);
      const actor = currentUser(req);
      const row = await transaction(async (tx) => {
        await lockAccessChanges(tx);
        await assertAdminAccess(tx, actor.id, req.sessionId);
        const old = await tx.user.findUnique({
          where: { id },
          include: { driver: true },
        });
        ensure(old, 404, "No se encontró el usuario.", "NOT_FOUND");
        const role =
          "role" in input && input.role !== undefined ? input.role : old.role;
        const active = input.active ?? old.active;
        const changed = role !== old.role || active !== old.active;
        if (!changed) return old;
        ensure(
          id !== actor.id || (active && role === "ADMIN"),
          409,
          "No podés desactivar tu propio acceso ni quitarte el rol de administrador.",
          "SELF_ACCESS_CHANGE",
        );
        if (
          old.active &&
          old.role === "ADMIN" &&
          (!active || role !== "ADMIN")
        ) {
          const administrators = await tx.user.count({
            where: { active: true, role: "ADMIN" },
          });
          ensure(
            administrators > 1,
            409,
            "Debe quedar al menos un administrador activo.",
            "LAST_ADMIN",
          );
        }
        if (old.driver)
          await tx.$queryRaw`SELECT id FROM tomasini."Driver" WHERE id = ${old.driver.id}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM tomasini."User" WHERE id = ${id}::uuid FOR UPDATE`;
        if (old.driver && (!active || role === "ADMIN")) {
          await tx.driver.update({
            where: { id: old.driver.id },
            data: { assignedTruckId: null },
          });
        }
        const updated = await tx.user.update({
          where: { id },
          data: {
            role,
            active,
            ...(role === "DRIVER" && !old.driver
              ? { driver: { create: {} } }
              : {}),
          },
          include: { driver: true },
        });
        await tx.session.deleteMany({ where: { userId: id } });
        if (old.driver)
          await revokeDriverInvitations(
            tx,
            old.driver.id,
            actor.id,
            "Cambió el rol o estado del usuario.",
          );
        if (!active || (old.role === "ADMIN" && role !== "ADMIN"))
          await revokeIssuedInvitations(
            tx,
            id,
            actor.id,
            "El emisor perdió su acceso de administración.",
          );
        await audit(
          tx,
          actor.id,
          "USER",
          id,
          !active && old.active
            ? "DEACTIVATED"
            : active && !old.active
              ? "REACTIVATED"
              : "ROLE_CHANGED",
          {
            ...accessDto(old),
            assignedTruckId: old.driver?.assignedTruckId ?? null,
          },
          {
            ...accessDto(updated),
            assignedTruckId: updated.driver?.assignedTruckId ?? null,
          },
        );
        return updated;
      });
      res.json(accessDto(row));
    };
  router.patch("/:id", change(false));
  router.delete("/:id", change(true));
  return router;
}

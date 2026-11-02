import type { Tx } from "./db.js";
import { ensure } from "./errors.js";

// Database-scoped lock shared by account, credential and invitation mutations.
// Take it before any Driver/User/Invitation row lock to preserve one lock order.
export async function lockAccessChanges(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1819235121, 1)`;
}

export async function assertAdminAccess(
  tx: Tx,
  actorId: string,
  sessionId: string | undefined,
) {
  await tx.$queryRaw`SELECT id FROM tomasini."User" WHERE id = ${actorId}::uuid FOR UPDATE`;
  const actor = await tx.user.findUnique({ where: { id: actorId } });
  const session = sessionId
    ? await tx.session.findUnique({ where: { id: sessionId } })
    : null;
  ensure(
    actor?.active &&
      session?.userId === actorId &&
      session.expiresAt > new Date(),
    401,
    "Tu sesión venció. Volvé a ingresar.",
    "UNAUTHENTICATED",
  );
  ensure(
    actor.role === "ADMIN",
    403,
    "Esta acción es exclusiva de administración.",
    "FORBIDDEN",
  );
  ensure(
    !actor.mustChangePassword,
    403,
    "Primero cambiá tu contraseña provisoria.",
    "PASSWORD_CHANGE_REQUIRED",
  );
}

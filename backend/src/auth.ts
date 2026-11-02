import { Router, type RequestHandler, type Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { User, Driver } from "@prisma/client";
import { getDb, transaction } from "./db.js";
import { lockAccessChanges } from "./access-control.js";
import { getConfig } from "./config.js";
import { AppError, ensure } from "./errors.js";
import { hashPassword, verifyPassword } from "./password.js";
import { password, username } from "./validation.js";

export type AuthUser = User & { driver: Driver | null };
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}
export function currentUser(req: Request) {
  ensure(req.user, 401, "Iniciá sesión para continuar.", "UNAUTHENTICATED");
  return req.user;
}
export function userDto(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
    driverId: user.driver?.id ?? null,
  };
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const csrf: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (
    req.get("x-tomasini-request") !== "1" ||
    (origin !== undefined && origin !== getConfig().origin) ||
    req.get("sec-fetch-site") === "cross-site"
  )
    return next(
      new AppError(403, "La solicitud no pertenece a esta aplicación.", "CSRF"),
    );
  next();
};
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[getConfig().cookieName];
  ensure(
    typeof token === "string" && /^[a-f0-9]{64}$/.test(token),
    401,
    "Iniciá sesión para continuar.",
    "UNAUTHENTICATED",
  );
  const session = await getDb().session.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: { include: { driver: true } } },
  });
  ensure(
    session && session.expiresAt > new Date() && session.user.active,
    401,
    "Tu sesión venció. Volvé a ingresar.",
    "UNAUTHENTICATED",
  );
  req.user = session.user;
  req.sessionId = session.id;
  next();
};
export const requireAdmin: RequestHandler = (req, _res, next) => {
  ensure(
    currentUser(req).role === "ADMIN",
    403,
    "Esta acción es exclusiva de administración.",
    "FORBIDDEN",
  );
  next();
};
export const requireChangedPassword: RequestHandler = (req, _res, next) => {
  ensure(
    !currentUser(req).mustChangePassword,
    403,
    "Primero cambiá tu contraseña provisoria.",
    "PASSWORD_CHANGE_REQUIRED",
  );
  next();
};

const limits = new Map<string, { count: number; until: number }>();
export function throttle(key: string, maximum: number) {
  const now = Date.now();
  if (limits.size > 10_000)
    for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  const entry = limits.get(key);
  if (!entry || entry.until < now) {
    limits.set(key, { count: 1, until: now + 15 * 60_000 });
    return;
  }
  entry.count++;
  ensure(
    entry.count <= maximum,
    429,
    "Demasiados intentos. Esperá 15 minutos y volvé a intentar.",
    "RATE_LIMIT",
  );
}
export function authRouter() {
  const router = Router();
  router.post("/login", async (req, res) => {
    const input = z
      .object({ username, password: z.string().min(1).max(128) })
      .strict()
      .parse(req.body);
    throttle(`ip:${req.ip}`, 50);
    throttle(`user:${input.username}`, 12);
    const user = await getDb().user.findUnique({
      where: { username: input.username },
      include: { driver: true },
    });
    const valid = await verifyPassword(input.password, user?.passwordHash);
    ensure(
      user && valid && user.active,
      401,
      "Usuario o contraseña incorrectos.",
      "INVALID_CREDENTIALS",
    );
    limits.delete(`user:${input.username}`);
    const token = randomBytes(32).toString("hex");
    const cfg = getConfig();
    const expiresAt = new Date(Date.now() + cfg.sessionDays * 86_400_000);
    const authenticated = await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await tx.$queryRaw`SELECT id FROM tomasini."User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      const latest = await tx.user.findUnique({
        where: { id: user.id },
        include: { driver: true },
      });
      ensure(
        latest?.active &&
          latest.passwordHash === user.passwordHash &&
          latest.username === input.username,
        401,
        "Usuario o contraseña incorrectos.",
        "INVALID_CREDENTIALS",
      );
      await tx.session.create({
        data: { userId: latest.id, tokenHash: digest(token), expiresAt },
      });
      return latest;
    });
    res.cookie(cfg.cookieName, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: cfg.production,
      expires: expiresAt,
      path: "/",
    });
    res.json(userDto(authenticated));
  });
  router.use(authenticate);
  router.get("/me", (req, res) => res.json(userDto(currentUser(req))));
  router.post("/logout", async (req, res) => {
    await getDb().session.deleteMany({ where: { id: req.sessionId } });
    const cfg = getConfig();
    res.clearCookie(cfg.cookieName, {
      httpOnly: true,
      sameSite: "strict",
      secure: cfg.production,
      path: "/",
    });
    res.sendStatus(204);
  });
  router.post("/password", async (req, res) => {
    const input = z
      .object({ currentPassword: z.string().max(128), newPassword: password })
      .strict()
      .parse(req.body);
    const user = currentUser(req);
    throttle(`password:${user.id}`, 10);
    ensure(
      await verifyPassword(input.currentPassword, user.passwordHash),
      400,
      "La contraseña actual es incorrecta.",
      "INVALID_PASSWORD",
    );
    ensure(
      input.currentPassword !== input.newPassword,
      400,
      "Elegí una contraseña diferente a la actual.",
    );
    const passwordHash = await hashPassword(input.newPassword);
    await transaction(async (tx) => {
      await lockAccessChanges(tx);
      await tx.$queryRaw`SELECT id FROM tomasini."User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      const latest = await tx.user.findUnique({ where: { id: user.id } });
      const session = await tx.session.findUnique({
        where: { id: req.sessionId },
      });
      ensure(
        latest?.active &&
          latest.passwordHash === user.passwordHash &&
          session?.userId === user.id &&
          session.expiresAt > new Date(),
        401,
        "Tu acceso cambió. Volvé a ingresar.",
        "UNAUTHENTICATED",
      );
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.session.deleteMany({
        where: { userId: user.id, id: { not: req.sessionId } },
      });
    });
    res.sendStatus(204);
  });
  return router;
}

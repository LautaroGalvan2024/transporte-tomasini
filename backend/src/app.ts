import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getConfig } from "./config.js";
import { assertDatabaseScope } from "./db.js";
import {
  authRouter,
  authenticate,
  csrf,
  requireChangedPassword,
} from "./auth.js";
import { trucksRouter, driversRouter } from "./fleet.js";
import { tripsRouter } from "./trips.js";
import { obligationsRouter } from "./obligations.js";
import { dashboardRouter } from "./dashboard.js";
import { errorHandler } from "./errors.js";
import { invitationsRouter, publicInvitationsRouter } from "./invitations.js";

export function createApp() {
  const cfg = getConfig(),
    app = express();
  app.disable("x-powered-by");
  // The only supported reverse proxy is the local Nginx instance.
  if (cfg.production) app.set("trust proxy", "loopback");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: cfg.production ? [] : null,
        },
      },
      strictTransportSecurity: cfg.production ? { maxAge: 15_552_000 } : false,
    }),
  );
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/ready", async (_req, res) => {
    try {
      await assertDatabaseScope();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(
    "/api",
    express.json({ limit: "64kb" }),
    cookieParser(),
    csrf,
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.use("/api/auth", authRouter());
  app.use("/api/invitations", publicInvitationsRouter());
  app.use("/api", authenticate, requireChangedPassword);
  app.use("/api/invitations", invitationsRouter());
  app.use("/api/trucks", trucksRouter());
  app.use("/api/drivers", driversRouter());
  app.use("/api/trips", tripsRouter());
  app.use("/api/obligations", obligationsRouter());
  app.use("/api", dashboardRouter());
  app.use("/api", (_req, res) =>
    res.status(404).json({
      error: { message: "No se encontró esta operación.", code: "NOT_FOUND" },
    }),
  );
  if (cfg.production) {
    const dir = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
    if (existsSync(dir)) {
      app.use(express.static(dir, { index: false, maxAge: "1h" }));
      app.get("/{*path}", (_req, res) => {
        res.setHeader("Cache-Control", "no-cache");
        res.sendFile(`${dir}/index.html`);
      });
    }
  }
  app.use(errorHandler);
  return app;
}

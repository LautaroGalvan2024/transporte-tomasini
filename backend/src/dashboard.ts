import { Router } from "express";
import { getDb } from "./db.js";
import { currentUser, requireAdmin } from "./auth.js";
import { BUSINESS_TIMEZONE, smtpConfigured } from "./config.js";
import { businessDay, dayStart } from "./domain.js";
import {
  driverDtos,
  truckDtos,
  obligationDtos,
  tripInclude,
  tripDto,
  readSnapshot,
} from "./models.js";
import { settingsBody } from "./validation.js";
import { totalTripDistance } from "./trip-mileage.js";

export function dashboardRouter() {
  const router = Router();
  router.get("/dashboard", async (req, res) => {
    const user = currentUser(req),
      now = new Date(),
      monthStart = dayStart(`${businessDay(now).slice(0, 7)}-01`);
    const own = user.role === "DRIVER" ? { driverId: user.driver!.id } : {};
    const { sum, pendingReviews, recent, allObligations, trucks, drivers } =
      await readSnapshot(getDb(), async (tx) => {
        const sum = await tx.trip.aggregate({
          where: { ...own, status: "ACTIVE", departureAt: { gte: monthStart } },
          _count: true,
          _sum: {
            endKm: true,
            startKm: true,
            manualDistanceKm: true,
            allowance: true,
          },
        });
        const pendingReviews = await tx.trip.count({
          where: { ...own, status: "ACTIVE", reviewedAt: null },
        });
        const recent = await tx.trip.findMany({
          where: { ...own, status: "ACTIVE" },
          include: tripInclude,
          orderBy: { departureAt: "desc" },
          take: 5,
        });
        const trucks = await truckDtos(tx);
        const allObligations = await obligationDtos(user, tx, now, trucks);
        const drivers = await driverDtos(user, tx, trucks);
        return { sum, pendingReviews, recent, allObligations, trucks, drivers };
      });
    const obligations = allObligations.filter((o) => o.active && o.ownerActive);
    const currentDriver =
      drivers.find((driver) => driver.userId === user.id && driver.active) ??
      null;
    res.json({
      stats: {
        tripsThisMonth: sum._count,
        kilometersThisMonth: totalTripDistance(sum._sum),
        pendingReviews,
        overdue: obligations.filter((o) => o.status === "OVERDUE").length,
        upcoming: obligations.filter((o) => o.status === "UPCOMING").length,
        allowanceThisMonth: sum._sum.allowance?.toFixed(2) ?? "0.00",
      },
      recentTrips: recent.map(tripDto),
      obligations,
      trucks: trucks.filter((t) => t.active),
      currentDriver,
      assignedTruck:
        trucks.find((t) => t.id === currentDriver?.assignedTruckId) ?? null,
    });
  });
  router.get("/settings", requireAdmin, async (_req, res) => {
    const row = await getDb().setting.findUniqueOrThrow({
      where: { id: "main" },
    });
    res.json(settingsDto(row));
  });
  router.patch("/settings", requireAdmin, async (req, res) => {
    const input = settingsBody.parse(req.body);
    const row = await getDb().setting.update({
      where: { id: "main" },
      data: input,
    });
    res.json(settingsDto(row));
  });
  router.get("/notifications", requireAdmin, async (_req, res) => {
    const rows = await getDb().notification.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        date: true,
        recipient: true,
        status: true,
        error: true,
        sentAt: true,
        attempts: true,
      },
    });
    res.json({
      items: rows.map((r) => ({
        ...r,
        date: r.date.toISOString().slice(0, 10),
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
    });
  });
  return router;
}
function settingsDto(row: {
  recipientEmail: string | null;
  warningDays: number;
  warningKm: number;
}) {
  return {
    recipientEmail: row.recipientEmail,
    warningDays: row.warningDays,
    warningKm: row.warningKm,
    smtpConfigured: smtpConfigured(),
    timezone: BUSINESS_TIMEZONE,
    sendHour: 8,
  };
}

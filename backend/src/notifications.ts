import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import { z } from "zod";
import { getDb } from "./db.js";
import { businessDay, businessHour } from "./domain.js";
import { obligationDtos, auditJson } from "./models.js";
import { getConfig, smtpConfigured } from "./config.js";

type Sender = (message: SendMailOptions) => Promise<unknown>;
const MAX_ATTEMPTS = 5;
function sender(): Sender {
  const port = z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .parse(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD))
    throw new Error("SMTP_AUTH_CONFIG");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
  });
  return async (message) => {
    try {
      return await transport.sendMail(message);
    } finally {
      transport.close();
    }
  };
}
function safeFailure(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  const description: Record<string, string> = {
    EAUTH: "SMTP rechazó las credenciales.",
    ETIMEDOUT: "El servidor de correo no respondió a tiempo.",
    ECONNECTION: "No se pudo conectar al servidor de correo.",
    ESOCKET: "Falló la conexión segura al correo.",
    EENVELOPE: "El servidor rechazó el remitente o destinatario.",
    EMESSAGE: "El servidor rechazó el mensaje.",
  };
  return (
    description[code] ??
    "No se pudo entregar el correo. Revisá la configuración SMTP."
  );
}
export async function runNotificationJob(
  options: { now?: Date; send?: Sender; configured?: boolean } = {},
) {
  const now = options.now ?? new Date(),
    today = businessDay(now),
    db = getDb();
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  if (businessHour(now) < 8)
    return { sent: 0, pending: 0, reason: "BEFORE_SEND_HOUR" };
  const settings = await db.setting.findUniqueOrThrow({
    where: { id: "main" },
  });
  await db.notification.updateMany({
    where: {
      status: { in: ["PENDING", "SENDING"] },
      date: { lt: new Date(today) },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: {
      status: "SUPERSEDED",
      error: "Reemplazado por el resumen del día actual.",
      leaseUntil: null,
    },
  });
  if (!settings.recipientEmail)
    return { sent: 0, pending: 0, reason: "NO_RECIPIENT" };
  const alerts = (await obligationDtos(undefined, db, now)).filter(
    (o) => o.active && (o.status === "OVERDUE" || o.status === "UPCOMING"),
  );
  if (alerts.length === 0) {
    await db.notification.updateMany({
      where: {
        date: new Date(today),
        recipient: settings.recipientEmail,
        status: "PENDING",
      },
      data: {
        status: "CANCELLED",
        error: "Los vencimientos pendientes fueron resueltos.",
      },
    });
    return { sent: 0, pending: 0, reason: "NO_ALERTS" };
  }
  const payload = auditJson({
    date: today,
    alerts: alerts.map((o) => ({
      id: o.id,
      title: o.title,
      target: o.truck?.plate ?? o.driver?.name,
      status: o.status,
      dueDate: o.dueDate,
      dueKm: o.dueKm,
      daysRemaining: o.daysRemaining,
      kmRemaining: o.kmRemaining,
      odometerAt: o.truck?.odometerAt,
    })),
  });
  const job = await db.notification.upsert({
    where: {
      date_recipient: {
        date: new Date(today),
        recipient: settings.recipientEmail,
      },
    },
    update: {},
    create: {
      date: new Date(today),
      recipient: settings.recipientEmail,
      payload,
      nextAttemptAt: now,
    },
  });
  if (["SENT", "FAILED"].includes(job.status) || job.attempts >= MAX_ATTEMPTS)
    return { sent: 0, pending: 0, reason: job.status };
  if (!(options.configured ?? smtpConfigured())) {
    await db.notification.updateMany({
      where: { id: job.id, status: { in: ["PENDING", "CANCELLED"] } },
      data: {
        status: "PENDING",
        error: "SMTP sin configurar. El resumen todavía no se envió.",
      },
    });
    return { sent: 0, pending: 1, reason: "SMTP_NOT_CONFIGURED" };
  }
  // Atomic claim prevents overlapping timer invocations from sending the same digest.
  const claimed = await db.notification.updateMany({
    where: {
      id: job.id,
      attempts: { lt: MAX_ATTEMPTS },
      nextAttemptAt: { lte: now },
      OR: [
        { status: { in: ["PENDING", "CANCELLED"] } },
        { status: "SENDING", leaseUntil: { lt: now } },
      ],
    },
    data: {
      status: "SENDING",
      leaseUntil: new Date(now.getTime() + 5 * 60_000),
      attempts: { increment: 1 },
      error: null,
      payload,
    },
  });
  if (!claimed.count)
    return { sent: 0, pending: 1, reason: "WAITING_OR_CLAIMED" };
  const attempt = job.attempts + 1;
  const lines = alerts.map((o) => {
    const target = o.truck?.plate ?? o.driver?.name ?? "Sin asignar";
    const deadline = [
      o.dueDate ? `fecha ${o.dueDate}` : "",
      o.dueKm !== null ? `${o.dueKm.toLocaleString("es-AR")} km` : "",
    ]
      .filter(Boolean)
      .join(" o ");
    const reading =
      o.truck && o.dueKm !== null
        ? ` Última lectura: ${o.truck.odometer.toLocaleString("es-AR")} km (${businessDay(new Date(o.truck.odometerAt))}).`
        : "";
    return `- ${o.status === "OVERDUE" ? "VENCIDO" : "POR VENCER"}: ${o.title} · ${target} · ${deadline}.${reading}`;
  });
  try {
    const send = options.send ?? sender();
    await send({
      from: process.env.SMTP_FROM ?? "tomasini@example.invalid",
      to: settings.recipientEmail,
      subject: `Transporte Tomasini · Vencimientos ${today}`,
      text: `Resumen de vencimientos de Transporte Tomasini\n\n${lines.join("\n")}\n\nAbrir el sistema: ${getConfig().origin}\n\nLos avisos por kilómetros dependen de las lecturas registradas.`,
      messageId: `<tomasini-${job.id}@${new URL(getConfig().origin).hostname}>`,
      headers: { "X-Tomasini-Notification": job.id },
    });
    await db.notification.update({
      where: { id: job.id },
      data: { status: "SENT", sentAt: now, leaseUntil: null, error: null },
    });
    return { sent: 1, pending: 0, reason: "SENT" };
  } catch (error) {
    await db.notification.update({
      where: { id: job.id },
      data: {
        status: attempt >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        leaseUntil: null,
        error: safeFailure(error),
        nextAttemptAt: new Date(
          now.getTime() + 15 * 60_000 * 2 ** (attempt - 1),
        ),
      },
    });
    return {
      sent: 0,
      pending: attempt >= MAX_ATTEMPTS ? 0 : 1,
      reason: attempt >= MAX_ATTEMPTS ? "FAILED" : "RETRY_SCHEDULED",
    };
  }
}

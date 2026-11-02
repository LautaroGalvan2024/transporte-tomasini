import { createHash } from "node:crypto";
import { z } from "zod";
import { password, text, username, uuid } from "./validation.js";

export const invitationToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "El enlace de invitación no es válido.");
export const invitationCreate = z
  .object({
    role: z.enum(["ADMIN", "DRIVER"]),
    name: text(120).nullable().optional(),
    driverId: uuid.nullable().optional(),
    expiresInDays: z.number().int().min(1).max(30).default(7),
  })
  .strict()
  .refine((input) => !input.driverId || input.role === "DRIVER", {
    message:
      "Solo una invitación de chofer puede vincularse a un chofer existente.",
    path: ["driverId"],
  });
export const invitationAccept = z
  .object({ token: invitationToken, name: text(120), username, password })
  .strict();
export const invitationPreview = z.object({ token: invitationToken }).strict();
export const invitationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export function invitationTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function invitationStatus(
  row: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now = new Date(),
) {
  if (row.acceptedAt) return "ACCEPTED" as const;
  if (row.revokedAt) return "REVOKED" as const;
  if (row.expiresAt <= now) return "EXPIRED" as const;
  return "PENDING" as const;
}

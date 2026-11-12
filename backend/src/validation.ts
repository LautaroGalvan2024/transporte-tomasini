import { z } from "zod";

export const uuid = z.uuid({ error: "Identificador inválido." });
export const text = (max = 180) =>
  z.string().trim().min(1, "Este campo es obligatorio.").max(max);
export const km = z
  .number()
  .int("Ingresá kilómetros enteros.")
  .min(0)
  .max(9_999_999);
export const instant = z.iso.datetime({
  offset: true,
  error: "Fecha y hora inválidas.",
});
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida.")
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Fecha inválida.",
  );
export const password = z
  .string()
  .min(12, "Usá al menos 12 caracteres.")
  .max(128, "Usá hasta 128 caracteres.");
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9._-]+$/, "Usá letras, números, punto, guion o guion bajo.");
export const notes = z.string().trim().max(2000).nullable().optional();
const money = z
  .union([
    z.number(),
    z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Importe inválido."),
  ])
  .transform(Number)
  .refine(
    (n) =>
      Number.isFinite(n) &&
      n >= 0 &&
      n <= 999_999_999_999.99 &&
      Math.abs(n * 100 - Math.round(n * 100)) < 0.01,
    "Ingresá un importe positivo con hasta dos decimales.",
  )
  .transform((n) => n.toFixed(2));
export const tripFields = z
  .object({
    driverId: uuid.optional(),
    truckId: uuid,
    trailerId: uuid.nullable().optional(),
    origin: text(),
    destination: text(),
    departureAt: instant,
    arrivalAt: instant,
    startKm: km,
    endKm: km,
    controlCount: z
      .int32("Ingresá una cantidad entera de controles.")
      .nonnegative("La cantidad de controles no puede ser negativa.")
      .nullish(),
    allowance: money.nullable().optional(),
    notes,
  })
  .strict();
export const tripCreate = tripFields.extend({ clientRequestId: uuid });
export const tripUpdate = tripFields.partial().extend({
  version: z.number().int().positive(),
  clientRequestId: uuid.optional(),
});
export const versionBody = z
  .object({ version: z.number().int().positive() })
  .strict();
export const cancelBody = versionBody.extend({ reason: text(500) });
export const initialRecord = z
  .object({ performedAt: instant, odometer: km.nullable().optional(), notes })
  .strict();
export const obligationFields = z
  .object({
    title: text(),
    kind: z.enum(["SERVICE", "DOCUMENT"]),
    truckId: uuid.nullable().optional(),
    driverId: uuid.nullable().optional(),
    trailerId: uuid.nullable().optional(),
    dueDate: day.nullable().optional(),
    dueKm: km.nullable().optional(),
    intervalMonths: z.number().int().min(1).max(120).nullable().optional(),
    intervalKm: km
      .refine((n) => n > 0)
      .nullable()
      .optional(),
    warningDays: z.number().int().min(0).max(365).optional(),
    warningKm: km.optional(),
    notes,
  })
  .strict();
export const obligationCreate = obligationFields.extend({
  initialRecord: initialRecord.optional(),
});
export const obligationUpdate = obligationFields.partial().extend({
  version: z.number().int().positive(),
  active: z.boolean().optional(),
});
export const renewalBody = initialRecord.extend({
  nextDueDate: day.nullable().optional(),
  nextDueKm: km.nullable().optional(),
  version: z.number().int().positive(),
});
export const plate = text(16)
  .transform((s) => s.toUpperCase().replace(/[ -]/g, ""))
  .refine((s) => /^[A-Z0-9]{4,12}$/.test(s), "Patente inválida.");
const truckFields = z
  .object({
    plate,
    label: text(120),
    initialOdometer: km.nullable().optional(),
    initialOdometerAt: instant.nullable().optional(),
  })
  .strict();
export const truckCreate = truckFields.refine(
  (value) =>
    (value.initialOdometer == null) === (value.initialOdometerAt == null),
  {
    message:
      "Ingresá el kilometraje y la fecha de lectura juntos, o dejá ambos sin informar.",
    path: ["initialOdometerAt"],
  },
);
export const truckUpdate = truckFields
  .pick({ plate: true, label: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export const trailerCreate = z
  .object({
    plate,
    label: text(120),
    assignedTruckId: uuid.nullable().optional(),
  })
  .strict();
export const trailerUpdate = trailerCreate
  .pick({ plate: true, label: true })
  .partial()
  .extend({
    version: z.number().int().positive(),
    active: z.boolean().optional(),
  });
export const trailerAssignment = z
  .object({
    version: z.number().int().positive(),
    assignedTruckId: uuid.nullable(),
  })
  .strict();
export const driverCreate = z
  .object({
    name: text(120),
    username,
    password,
    phone: z.string().trim().max(40).nullable().optional(),
    assignedTruckId: uuid.nullable().optional(),
  })
  .strict();
export const driverUpdate = driverCreate
  .omit({ password: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export const settingsBody = z
  .object({
    recipientEmail: z.email().max(254).nullable(),
    warningDays: z.number().int().min(0).max(365),
    warningKm: km,
  })
  .strict();
export const tripQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  driverId: uuid.optional(),
  truckId: uuid.optional(),
  trailerId: uuid.optional(),
  reviewed: z.enum(["yes", "no"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

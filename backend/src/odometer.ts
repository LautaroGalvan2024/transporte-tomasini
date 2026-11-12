import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Tx } from "./db.js";
import { validateReadings, type Reading } from "./domain.js";
import { ensure } from "./errors.js";
import { instant, km } from "./validation.js";

export const ODOMETER_ADJUSTED = "ODOMETER_ADJUSTED";
export const ODOMETER_INITIALIZED = "ODOMETER_INITIALIZED";
export const odometerBody = z
  .object({
    odometer: km,
    expectedOdometer: km.nullable(),
    expectedOdometerAt: instant.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.expectedOdometer === null) === (value.expectedOdometerAt === null),
    {
      message: "La lectura de referencia está incompleta. Actualizá el camión.",
      path: ["expectedOdometerAt"],
    },
  );

const adjustmentData = z
  .object({
    version: z.literal(1),
    odometer: km,
    odometerAt: instant,
  })
  .strict();

export interface OdometerAdjustment {
  at: Date;
  km: number;
}

// These typed, append-only audit events are permanent odometer records, not
// disposable logging. Original readings and trip distances are never rewritten.
export function adjustmentReading(after: Prisma.JsonValue): OdometerAdjustment {
  const data = adjustmentData.parse(after);
  return { at: new Date(data.odometerAt), km: data.odometer };
}

export async function odometerAdjustments(tx: Tx, truckId: string) {
  const rows = await tx.audit.findMany({
    where: { entity: "TRUCK", entityId: truckId, action: ODOMETER_ADJUSTED },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { after: true },
  });
  return rows.map((row) => adjustmentReading(row.after));
}

export function validateAdjustedHistory(
  readings: Reading[],
  adjustments: OdometerAdjustment[],
  trips: Array<{ departureAt: Date; arrivalAt: Date }>,
) {
  const cuts = [...adjustments].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const trip of trips) {
    ensure(
      !cuts.some(
        (cut) => trip.departureAt < cut.at && trip.arrivalAt >= cut.at,
      ),
      409,
      "El viaje abarca una corrección de odómetro. Revisá sus fechas o registrá por separado los recorridos anteriores y posteriores a la corrección.",
      "ODOMETER_ADJUSTMENT_BOUNDARY",
    );
  }
  const segments: Reading[][] = [
    [],
    ...cuts.map((cut) => [{ ...cut, label: "corrección de odómetro" }]),
  ];
  for (const reading of readings) {
    let segment = 0;
    while (segment < cuts.length && cuts[segment].at <= reading.at) segment++;
    segments[segment].push(reading);
  }
  for (const segment of segments) validateReadings(segment);
}

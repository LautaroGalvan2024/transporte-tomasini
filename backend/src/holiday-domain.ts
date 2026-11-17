import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors.js";

export const HOLIDAY_TIMEZONE = "America/Argentina/Buenos_Aires";
const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value,
  );
export const holidayEntrySchema = z
  .object({
    date: daySchema,
    name: z.string().trim().min(1).max(180),
    source: z.enum(["official", "manual"]),
    enabled: z.boolean(),
  })
  .strict();
export type HolidayEntry = z.infer<typeof holidayEntrySchema>;
const entriesSchema = z
  .array(holidayEntrySchema)
  .max(366)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      if (seen.has(entry.date))
        ctx.addIssue({
          code: "custom",
          path: [index, "date"],
          message: "Esta fecha está repetida.",
        });
      seen.add(entry.date);
    });
  });
const proposalSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.iso.datetime(),
    sourceUrl: z.url(),
    entries: entriesSchema,
    sourceEntries: entriesSchema,
  })
  .strict();
const yearStateSchema = z
  .object({
    year: z.number().int().min(1900).max(2199),
    version: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    confirmedAt: z.iso.datetime().nullable(),
    entries: entriesSchema,
    proposal: proposalSchema.nullable(),
    officialBaseline: entriesSchema,
    lastOfficialHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    lastCheckedAt: z.iso.datetime().nullable(),
    lastCheckError: z.string().max(300).nullable(),
  })
  .strict()
  .superRefine((state, ctx) => {
    const prefix = `${state.year}-`;
    for (const list of [
      state.entries,
      state.officialBaseline,
      state.proposal?.entries ?? [],
      state.proposal?.sourceEntries ?? [],
    ]) {
      if (list.some((entry) => !entry.date.startsWith(prefix)))
        ctx.addIssue({
          code: "custom",
          message: "La fecha no pertenece al año del calendario.",
        });
    }
  });
export const holidayCalendarSchema = z
  .object({
    schemaVersion: z.literal(1),
    years: z.record(z.string().regex(/^\d{4}$/), yearStateSchema),
    lastSyncDay: daySchema.nullable(),
  })
  .strict()
  .superRefine((calendar, ctx) => {
    for (const [key, state] of Object.entries(calendar.years)) {
      if (key !== String(state.year))
        ctx.addIssue({
          code: "custom",
          message: "Año de calendario inconsistente.",
        });
    }
  });
export type HolidayCalendar = z.infer<typeof holidayCalendarSchema>;
export type HolidayYearState = z.infer<typeof yearStateSchema>;
export const holidayYearInput = z
  .object({
    version: z.number().int().nonnegative(),
    entries: entriesSchema,
    confirm: z.boolean(),
    proposalHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export function entriesHash(entries: HolidayEntry[]) {
  return createHash("sha256")
    .update(
      JSON.stringify([...entries].sort((a, b) => a.date.localeCompare(b.date))),
    )
    .digest("hex");
}
export function emptyHolidayYear(year: number): HolidayYearState {
  return {
    year,
    version: 0,
    revision: 0,
    confirmedAt: null,
    entries: [],
    proposal: null,
    officialBaseline: [],
    lastOfficialHash: null,
    lastCheckedAt: null,
    lastCheckError: null,
  };
}
export function mergeOfficialEntries(
  state: HolidayYearState,
  incoming: HolidayEntry[],
): HolidayEntry[] {
  const baseline = new Map(
    state.officialBaseline.map((entry) => [entry.date, entry]),
  );
  const active = new Map(state.entries.map((entry) => [entry.date, entry]));
  const merged = new Map(incoming.map((entry) => [entry.date, entry]));
  for (const date of baseline.keys()) {
    if (!active.has(date)) merged.delete(date);
  }
  for (const entry of active.values()) {
    const previous = baseline.get(entry.date);
    // Manual entries and administrative edits always survive a source refresh.
    if (
      entry.source === "manual" ||
      !previous ||
      entry.name !== previous.name ||
      entry.enabled !== previous.enabled
    )
      merged.set(entry.date, entry);
  }
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HOLIDAY_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function localParts(instant: number) {
  const parts = Object.fromEntries(
    localFormatter
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    civil: Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    ),
  };
}
export function argentinaDay(instant = new Date()): string {
  return localParts(instant.getTime()).day;
}
export function nextCivilDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}
// Resolve IANA offsets around the boundary, including historical DST. For a
// skipped midnight use the first valid instant; for a repeated one use the first.
export function argentinaInstant(day: string, hour = 0): Date {
  const civil = Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = civil + delta * 3_600_000;
    offsets.add(localParts(sample).civil - sample);
  }
  const candidates = [...offsets].map((offset) => civil - offset);
  const exact = candidates.filter(
    (candidate) => localParts(candidate).civil === civil,
  );
  if (exact.length) return new Date(Math.min(...exact));
  const later = candidates
    .filter((candidate) => localParts(candidate).civil > civil)
    .sort((a, b) => localParts(a).civil - localParts(b).civil || a - b);
  if (!later.length) throw new Error("No se pudo resolver la fecha argentina.");
  return new Date(later[0]);
}

export type Km100Preview = {
  mode: "NONE" | "FULL" | "PARTIAL" | "PENDING";
  suggestedKm: number | null;
  intervals: { start: string; end: string; label: string }[];
  missingYears: number[];
  calendarToken: string;
};
export function evaluateKm100(
  calendar: HolidayCalendar,
  trip: { departureAt: Date; arrivalAt: Date; startKm: number; endKm: number },
): Km100Preview {
  const start = trip.departureAt.getTime(),
    end = trip.arrivalAt.getTime(),
    distance = trip.endKm - trip.startKm;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end < start ||
    !Number.isInteger(distance) ||
    distance < 0
  )
    throw new Error("Fechas o kilómetros inválidos para km al 100%.");
  const first = argentinaDay(trip.departureAt),
    last = argentinaDay(new Date(Math.max(start, end - 1)));
  const years: number[] = [];
  for (
    let year = Number(first.slice(0, 4));
    year <= Number(last.slice(0, 4));
    year++
  )
    years.push(year);
  const missingYears = years.filter(
    (year) => !calendar.years[year]?.confirmedAt,
  );
  const calendarToken = createHash("sha256")
    .update(
      JSON.stringify(
        years.map((year) => {
          const state = calendar.years[year];
          return state?.confirmedAt
            ? {
                year,
                revision: state.revision,
                entries: state.entries
                  .filter((entry) => entry.enabled)
                  .sort((a, b) => a.date.localeCompare(b.date)),
              }
            : { year, confirmed: false };
        }),
      ),
    )
    .digest("hex");
  if (distance === 0)
    return {
      mode: "NONE",
      suggestedKm: 0,
      intervals: [],
      missingYears: [],
      calendarToken,
    };
  if (start === end)
    throw new Error("Un viaje con kilómetros requiere duración.");
  const raw: { start: number; end: number; labels: string[] }[] = [];
  // Unknown years cannot give a reliable classification. Avoid processing an
  // unbounded date range; the administrative coverage must be resolved first.
  if (missingYears.length)
    return {
      mode: "PENDING",
      suggestedKm: null,
      intervals: [],
      missingYears,
      calendarToken,
    };
  const holidays = new Map(
    years.flatMap((year) =>
      calendar.years[year].entries
        .filter((entry) => entry.enabled)
        .map((entry) => [entry.date, entry.name] as const),
    ),
  );
  for (let day = first; day <= last; day = nextCivilDay(day)) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(),
      holiday = holidays.get(day);
    if (weekday !== 0 && weekday !== 6 && !holiday) continue;
    const from = argentinaInstant(
      day,
      holiday || weekday === 0 ? 0 : 13,
    ).getTime();
    const to = argentinaInstant(nextCivilDay(day)).getTime();
    const labels = [
      ...(holiday ? [holiday] : []),
      ...(weekday === 0
        ? ["Domingo"]
        : weekday === 6
          ? ["Sábado desde las 13:00"]
          : []),
    ];
    if (Math.max(start, from) < Math.min(end, to))
      raw.push({
        start: Math.max(start, from),
        end: Math.min(end, to),
        labels,
      });
  }
  const union: typeof raw = [];
  for (const interval of raw) {
    const previous = union.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
      previous.labels = [...new Set([...previous.labels, ...interval.labels])];
    } else union.push(interval);
  }
  const covered = union.reduce(
    (total, interval) => total + interval.end - interval.start,
    0,
  );
  const mode =
    covered === 0 ? "NONE" : covered === end - start ? "FULL" : "PARTIAL";
  return {
    mode,
    suggestedKm: mode === "NONE" ? 0 : mode === "FULL" ? distance : null,
    intervals: union.map((interval) => ({
      start: new Date(interval.start).toISOString(),
      end: new Date(interval.end).toISOString(),
      label: interval.labels.join(" · "),
    })),
    missingYears,
    calendarToken,
  };
}
const contextSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["NONE", "FULL", "PARTIAL", "PENDING"]),
    calendarToken: z.string().regex(/^[a-f0-9]{64}$/),
    missingYears: z.array(z.number().int()),
    suggestedKm: z.number().int().nonnegative().nullable(),
    intervals: z.array(
      z
        .object({
          start: z.iso.datetime(),
          end: z.iso.datetime(),
          label: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type Km100Context = z.infer<typeof contextSchema>;
export function createKm100Context(preview: Km100Preview): string {
  return JSON.stringify(contextSchema.parse({ schemaVersion: 1, ...preview }));
}
export function parseKm100Context(
  value: string | null | undefined,
): Km100Context | null {
  if (value == null) return null;
  try {
    return contextSchema.parse(JSON.parse(value));
  } catch {
    throw new AppError(
      503,
      "El cálculo de km al 100% guardado necesita revisión administrativa.",
      "KM100_CONTEXT_INVALID",
    );
  }
}

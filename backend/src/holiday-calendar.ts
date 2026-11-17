import { Router } from "express";
import { z } from "zod";
import { getDb, type Tx } from "./db.js";
import { currentUser, requireAdmin } from "./auth.js";
import { assertAdminAccess, lockAccessChanges } from "./access-control.js";
import { AppError, ensure } from "./errors.js";
import { audit } from "./models.js";
import {
  argentinaDay,
  emptyHolidayYear,
  entriesHash,
  holidayCalendarSchema,
  holidayEntrySchema,
  holidayYearInput,
  mergeOfficialEntries,
  type HolidayCalendar,
  type HolidayEntry,
  type HolidayYearState,
} from "./holiday-domain.js";
export {
  evaluateKm100,
  createKm100Context,
  parseKm100Context,
} from "./holiday-domain.js";

export const HOLIDAY_CALENDAR_AUDIT_ID = "8242a166-13b5-449d-9858-f5f4491caa30";
const yearSchema = z.coerce.number().int().min(1900).max(2199);
export const officialCalendarUrl = (year: number) =>
  `https://www.argentina.gob.ar/sites/default/files/holidays-${yearSchema.parse(year)}-es.json`;
const SEED_CHECKED_AT = "2026-11-17T00:00:00.000Z";
// Reviewed source snapshot. It remains a proposal until an administrator
// confirms coverage; no guessed future holidays are activated.
const seed2026 = [
  ["01-01", "Año Nuevo"],
  ["02-16", "Carnaval"],
  ["02-17", "Carnaval"],
  ["03-24", "Día Nacional de la Memoria por la Verdad y la Justicia"],
  ["04-02", "Día del Veterano y de los Caídos en la Guerra de Malvinas"],
  ["04-03", "Viernes Santo Festividad Cristiana"],
  ["05-01", "Día del Trabajador"],
  ["05-25", "Día de la Revolución de Mayo"],
  [
    "06-15",
    "Paso a la Inmortalidad del Gral. Don Martín Miguel de Güemes (17/6)",
  ],
  ["06-20", "Paso a la Inmortalidad del Gral. Manuel Belgrano"],
  ["07-09", "Día de la Independencia"],
  ["08-17", "Paso a la Inmortalidad del Gral. José de San Martín"],
  ["10-12", "Día de la  Raza"],
  ["11-09", "Visita de Su Santidad el Papa León XIV"],
  ["11-23", "Día de la Soberanía Nacional (20/11)"],
  ["12-08", "Inmaculada Concepción de María"],
  ["12-25", "Navidad"],
].map(([date, name]): HolidayEntry => ({
  date: `2026-${date}`,
  name,
  source: "official",
  enabled: true,
}));

export function initialCalendar(): HolidayCalendar {
  const year = emptyHolidayYear(2026),
    hash = entriesHash(seed2026);
  year.proposal = {
    hash,
    checkedAt: SEED_CHECKED_AT,
    sourceUrl: officialCalendarUrl(2026),
    entries: structuredClone(seed2026),
    sourceEntries: structuredClone(seed2026),
  };
  year.lastOfficialHash = hash;
  return { schemaVersion: 1, years: { "2026": year }, lastSyncDay: null };
}
export function parseCalendar(
  value: string | null | undefined,
): HolidayCalendar {
  if (value == null) return initialCalendar();
  try {
    return holidayCalendarSchema.parse(JSON.parse(value));
  } catch {
    throw new AppError(
      503,
      "El calendario de feriados necesita una revisión administrativa.",
      "HOLIDAY_CALENDAR_INVALID",
    );
  }
}
export async function getCalendar(
  db: Pick<Tx, "setting"> = getDb(),
): Promise<HolidayCalendar> {
  const row = await db.setting.findUnique({
    where: { id: "main" },
    select: { holidayCalendar: true },
  });
  return parseCalendar(row?.holidayCalendar);
}
async function lockCalendar(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1819235121, 7)`;
  await tx.$queryRaw`SELECT id FROM tomasini."Setting" WHERE id = 'main' FOR UPDATE`;
}
// Every calendar mutation holds the same advisory lock and Setting row lock.
// ReadCommitted reads the latest value after a waiter acquires those locks;
// Serializable would retain a snapshot from before the wait and can repeatedly
// abort daily contenders while the winner stores the two source results.
function calendarTransaction<T>(run: (tx: Tx) => Promise<T>) {
  return getDb().$transaction(run, {
    isolationLevel: "ReadCommitted",
    maxWait: 5_000,
    timeout: 15_000,
  });
}
async function persistCalendar(tx: Tx, calendar: HolidayCalendar) {
  await tx.setting.update({
    where: { id: "main" },
    data: {
      holidayCalendar: JSON.stringify(holidayCalendarSchema.parse(calendar)),
    },
  });
}
export function holidayYearDto(calendar: HolidayCalendar, year: number) {
  const state = calendar.years[year] ?? emptyHolidayYear(year);
  return {
    year,
    version: state.version,
    revision: state.revision,
    confirmedAt: state.confirmedAt,
    entries: state.entries,
    proposal: state.proposal
      ? {
          hash: state.proposal.hash,
          checkedAt: state.proposal.checkedAt,
          sourceUrl: state.proposal.sourceUrl,
          entries: state.proposal.entries,
        }
      : null,
    lastCheckedAt: state.lastCheckedAt,
    lastCheckError: state.lastCheckError,
  };
}
export function holidayCalendarStatus(
  calendar: HolidayCalendar,
  now = new Date(),
) {
  const currentYear = Number(argentinaDay(now).slice(0, 4));
  const years = [
    ...new Set([
      currentYear,
      currentYear + 1,
      ...Object.keys(calendar.years).map(Number),
    ]),
  ].sort((a, b) => a - b);
  return {
    currentYear,
    needsConfirmation: !calendar.years[currentYear]?.confirmedAt,
    years: years.map((year) => {
      const state = calendar.years[year];
      return {
        year,
        confirmedAt: state?.confirmedAt ?? null,
        hasProposal: Boolean(state?.proposal),
        lastCheckError: state?.lastCheckError ?? null,
      };
    }),
  };
}
export function updateHolidayYear(
  calendar: HolidayCalendar,
  year: number,
  input: z.infer<typeof holidayYearInput>,
  now = new Date(),
): HolidayCalendar {
  yearSchema.parse(year);
  input = holidayYearInput.parse(input);
  ensure(
    input.entries.every((entry) => entry.date.startsWith(`${year}-`)),
    400,
    "Las fechas deben pertenecer al año seleccionado.",
  );
  const previous = calendar.years[year] ?? emptyHolidayYear(year);
  ensure(
    input.version === previous.version,
    409,
    "El calendario cambió. Recargá el año antes de guardar.",
    "CONFLICT",
  );
  if (input.proposalHash)
    ensure(
      previous.proposal?.hash === input.proposalHash,
      409,
      "La propuesta cambió. Recargala antes de confirmar.",
      "HOLIDAY_PROPOSAL_CHANGED",
    );
  const next = structuredClone(previous);
  next.entries = [...input.entries].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  next.version++;
  if (input.confirm) next.confirmedAt = now.toISOString();
  if (
    next.confirmedAt &&
    (!previous.confirmedAt ||
      entriesHash(previous.entries) !== entriesHash(next.entries))
  )
    next.revision++;
  if (input.proposalHash && previous.proposal) {
    next.officialBaseline = previous.proposal.sourceEntries;
    next.proposal = null;
  } else if (next.proposal)
    next.proposal.entries = mergeOfficialEntries(
      next,
      next.proposal.sourceEntries,
    );
  return { ...calendar, years: { ...calendar.years, [year]: next } };
}

const sourceSchema = z.object({
  temporalCoverage: z.string(),
  mainEntity: z.object({
    itemListElement: z
      .array(
        z.object({
          item: z.object({
            name: z.string().min(1).max(180),
            startDate: holidayEntrySchema.shape.date,
            additionalProperty: z.object({
              name: z.literal("tipo"),
              value: z.enum([
                "inamovible",
                "trasladable",
                "no_laborable",
                "turistico",
                "especial",
              ]),
            }),
            location: z.object({ name: z.string(), "@type": z.string() }),
          }),
        }),
      )
      .max(400),
  }),
});
export function parseOfficialCalendar(
  value: unknown,
  year: number,
): HolidayEntry[] {
  const source = sourceSchema.parse(value);
  if (source.temporalCoverage !== String(year))
    throw new Error("Año oficial diferente al solicitado.");
  const dates = new Map<string, HolidayEntry>();
  for (const { item } of source.mainEntity.itemListElement) {
    if (!item.startDate.startsWith(`${year}-`)) {
      if (item.startDate === `${year + 1}-01-01`) continue;
      throw new Error("La fuente contiene fechas de otro año.");
    }
    if (!["inamovible", "trasladable"].includes(item.additionalProperty.value))
      continue;
    if (
      item.location.name !== "Argentina" ||
      item.location["@type"] !== "Country"
    )
      continue;
    const prior = dates.get(item.startDate);
    dates.set(item.startDate, {
      date: item.startDate,
      name: prior ? `${prior.name} / ${item.name}`.slice(0, 180) : item.name,
      source: "official",
      enabled: true,
    });
  }
  if (dates.size < 10)
    throw new Error("El calendario oficial parece incompleto.");
  return [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export async function downloadOfficialCalendar(
  year: number,
  fetcher: typeof fetch = fetch,
): Promise<HolidayEntry[]> {
  const response = await fetcher(officialCalendarUrl(year), {
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Fuente oficial no disponible.");
  }
  if (Number(response.headers.get("content-length") ?? 0) > 524_288) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("Fuente demasiado grande.");
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > 524_288) throw new Error("Fuente demasiado grande.");
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return parseOfficialCalendar(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
    year,
  );
}
export function applyOfficialCheck(
  calendar: HolidayCalendar,
  year: number,
  entries: HolidayEntry[] | null,
  now = new Date(),
): HolidayCalendar {
  const state = structuredClone(calendar.years[year] ?? emptyHolidayYear(year));
  state.version++;
  state.lastCheckedAt = now.toISOString();
  state.lastCheckError = entries
    ? null
    : "No se pudo consultar un calendario oficial completo para este año. Se conserva la información anterior.";
  if (entries) {
    const hash = entriesHash(entries);
    if (hash !== state.lastOfficialHash) {
      state.proposal = {
        hash,
        checkedAt: now.toISOString(),
        sourceUrl: officialCalendarUrl(year),
        entries: mergeOfficialEntries(state, entries),
        sourceEntries: entries,
      };
      state.lastOfficialHash = hash;
    }
  }
  return { ...calendar, years: { ...calendar.years, [year]: state } };
}
export function holidayCalendarRouter() {
  const router = Router();
  router.use(requireAdmin);
  router.get("/status", async (_req, res) =>
    res.json(holidayCalendarStatus(await getCalendar())),
  );
  router.get("/:year", async (req, res) =>
    res.json(
      holidayYearDto(await getCalendar(), yearSchema.parse(req.params.year)),
    ),
  );
  router.put("/:year", async (req, res) => {
    const year = yearSchema.parse(req.params.year),
      input = holidayYearInput.parse(req.body),
      user = currentUser(req);
    const calendar = await calendarTransaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      await lockCalendar(tx);
      const before = await getCalendar(tx),
        after = updateHolidayYear(before, year, input);
      await persistCalendar(tx, after);
      await audit(
        tx,
        user.id,
        "HOLIDAY_CALENDAR",
        HOLIDAY_CALENDAR_AUDIT_ID,
        input.confirm ? "CONFIRMED" : "UPDATED",
        holidayYearDto(before, year),
        holidayYearDto(after, year),
      );
      return after;
    });
    res.json(holidayYearDto(calendar, year));
  });
  router.post("/:year/check", async (req, res) => {
    const year = yearSchema.parse(req.params.year),
      user = currentUser(req);
    let entries: HolidayEntry[] | null = null;
    try {
      entries = await downloadOfficialCalendar(year);
    } catch {
      /* Preserve active entries and report a safe error. */
    }
    const calendar = await calendarTransaction(async (tx) => {
      await lockAccessChanges(tx);
      await assertAdminAccess(tx, user.id, req.sessionId);
      await lockCalendar(tx);
      const before = await getCalendar(tx),
        after = applyOfficialCheck(before, year, entries);
      await persistCalendar(tx, after);
      await audit(
        tx,
        user.id,
        "HOLIDAY_CALENDAR",
        HOLIDAY_CALENDAR_AUDIT_ID,
        entries ? "CHECKED" : "CHECK_FAILED",
        holidayYearDto(before, year),
        holidayYearDto(after, year),
      );
      return after;
    });
    if (!entries)
      throw new AppError(
        502,
        holidayYearDto(calendar, year).lastCheckError!,
        "HOLIDAY_SOURCE_UNAVAILABLE",
      );
    res.json(holidayYearDto(calendar, year));
  });
  return router;
}
export async function runHolidayCalendarSync(
  now = new Date(),
  fetcher: typeof fetch = fetch,
) {
  const today = argentinaDay(now),
    year = Number(today.slice(0, 4));
  const claimed = await calendarTransaction(async (tx) => {
    await lockCalendar(tx);
    const calendar = await getCalendar(tx);
    if (calendar.lastSyncDay === today) return false;
    await persistCalendar(tx, { ...calendar, lastSyncDay: today });
    return true;
  });
  if (!claimed) return { checked: 0, failed: 0, reason: "ya consultado hoy" };
  const results = await Promise.allSettled([
    downloadOfficialCalendar(year, fetcher),
    downloadOfficialCalendar(year + 1, fetcher),
  ]);
  for (const [index, result] of results.entries()) {
    await calendarTransaction(async (tx) => {
      await lockCalendar(tx);
      const calendar = await getCalendar(tx);
      await persistCalendar(
        tx,
        applyOfficialCheck(
          calendar,
          year + index,
          result.status === "fulfilled" ? result.value : null,
          now,
        ),
      );
    });
  }
  return {
    checked: results.length,
    failed: results.filter((result) => result.status === "rejected").length,
    reason: "consulta diaria completada",
  };
}

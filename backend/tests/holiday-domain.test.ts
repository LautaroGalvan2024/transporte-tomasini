import test from "node:test";
import assert from "node:assert/strict";
import {
  argentinaDay,
  argentinaInstant,
  createKm100Context,
  emptyHolidayYear,
  evaluateKm100,
  holidayCalendarSchema,
  mergeOfficialEntries,
  parseKm100Context,
  type HolidayCalendar,
  type HolidayEntry,
} from "../src/holiday-domain.js";

const entry = (
  date: string,
  name = "Feriado",
  enabled = true,
): HolidayEntry => ({ date, name, enabled, source: "official" });
function calendar(
  years = [2026],
  entries: HolidayEntry[] = [],
): HolidayCalendar {
  return {
    schemaVersion: 1,
    lastSyncDay: null,
    years: Object.fromEntries(
      years.map((year) => [
        year,
        {
          ...emptyHolidayYear(year),
          confirmedAt: "2026-01-01T00:00:00.000Z",
          revision: 1,
          entries: entries.filter((item) => item.date.startsWith(`${year}-`)),
        },
      ]),
    ),
  };
}
function preview(
  from: string,
  to: string,
  source = calendar(),
  distance = 500,
) {
  const times = { departureAt: new Date(from), arrivalAt: new Date(to) };
  const measured = evaluateKm100(source, {
    ...times,
    startKm: 1000,
    manualDistanceKm: null,
    endKm: 1000 + distance,
  });
  const direct = evaluateKm100(source, {
    ...times,
    startKm: null,
    endKm: null,
    manualDistanceKm: distance,
  });
  assert.deepEqual(direct, measured);
  return measured;
}
test("km al 100: límites exactos del sábado, domingo y lunes", () => {
  assert.equal(
    preview("2026-11-14T10:00:00-03:00", "2026-11-14T13:00:00-03:00").mode,
    "NONE",
  );
  assert.equal(
    preview("2026-11-14T13:00:00-03:00", "2026-11-16T00:00:00-03:00").mode,
    "FULL",
  );
  assert.equal(
    preview("2026-11-16T00:00:00-03:00", "2026-11-16T01:00:00-03:00").mode,
    "NONE",
  );
  const mixed = preview(
    "2026-11-14T12:59:00-03:00",
    "2026-11-14T13:01:00-03:00",
  );
  assert.equal(mixed.mode, "PARTIAL");
  assert.equal(mixed.suggestedKm, null);
  assert.equal(mixed.intervals[0].start, "2026-11-14T16:00:00.000Z");
});
test("la intersección revisa el viaje completo aunque ambos extremos sean hábiles", () => {
  const result = preview(
    "2026-11-13T11:00:00-03:00",
    "2026-11-16T09:00:00-03:00",
  );
  assert.equal(result.mode, "PARTIAL");
  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].end, "2026-11-16T03:00:00.000Z");
});
test("feriados enteros, trasladados, deshabilitados y fines de semana superpuestos", () => {
  const source = calendar(
    [2026],
    [
      entry("2026-11-23", "Trasladado"),
      entry("2026-11-14", "Feriado sábado"),
      entry("2026-11-17", "Deshabilitado", false),
    ],
  );
  assert.equal(
    preview("2026-11-23T00:00:00-03:00", "2026-11-24T00:00:00-03:00", source)
      .mode,
    "FULL",
  );
  assert.equal(
    preview("2026-11-20T10:00:00-03:00", "2026-11-20T11:00:00-03:00", source)
      .mode,
    "NONE",
  );
  assert.equal(
    preview("2026-11-17T10:00:00-03:00", "2026-11-17T11:00:00-03:00", source)
      .mode,
    "NONE",
  );
  const overlap = preview(
    "2026-11-14T00:00:00-03:00",
    "2026-11-16T00:00:00-03:00",
    source,
  );
  assert.equal(overlap.mode, "FULL");
  assert.equal(overlap.suggestedKm, 500);
  assert.equal(overlap.intervals.length, 1);
  assert.equal(
    Date.parse(overlap.intervals[0].end) -
      Date.parse(overlap.intervals[0].start),
    48 * 3_600_000,
  );
});
test("cobertura de año nuevo usa el intervalo semiabierto y conserva pendientes", () => {
  assert.equal(
    preview("2026-12-31T20:00:00-03:00", "2027-01-01T00:00:00-03:00").mode,
    "NONE",
  );
  const missing = preview(
    "2026-12-31T20:00:00-03:00",
    "2027-01-01T01:00:00-03:00",
  );
  assert.equal(missing.mode, "PENDING");
  assert.deepEqual(missing.missingYears, [2027]);
  assert.equal(missing.suggestedKm, null);
  assert.equal(
    preview("2027-01-02T14:00:00-03:00", "2027-01-02T17:00:00-03:00").mode,
    "PENDING",
  );
});
test("cero kilómetros se resuelve en cero incluso sin calendario; entradas inválidas fallan", () => {
  const zero = preview(
    "2027-01-01T00:00:00-03:00",
    "2027-01-01T00:00:00-03:00",
    calendar(),
    0,
  );
  assert.equal(zero.mode, "NONE");
  assert.equal(zero.suggestedKm, 0);
  assert.throws(() =>
    preview("2026-11-14T15:00:00-03:00", "2026-11-14T15:00:00-03:00"),
  );
  assert.throws(() =>
    preview("2026-11-14T16:00:00-03:00", "2026-11-14T15:00:00-03:00"),
  );
});
test("IANA resuelve DST histórico argentino y medianoche omitida", () => {
  assert.equal(
    argentinaInstant("2008-01-01").toISOString(),
    "2008-01-01T02:00:00.000Z",
  );
  assert.equal(
    argentinaInstant("2008-07-01").toISOString(),
    "2008-07-01T03:00:00.000Z",
  );
  assert.equal(
    argentinaInstant("2007-12-30").toISOString(),
    "2007-12-30T03:00:00.000Z",
  );
  assert.equal(argentinaDay(new Date("2026-11-16T02:59:59Z")), "2026-11-15");
  const result = preview(
    "2007-12-29T13:00:00-03:00",
    "2007-12-31T00:00:00-02:00",
    calendar([2007]),
  );
  assert.equal(result.mode, "FULL");
  assert.equal(
    Date.parse(result.intervals[0].end) - Date.parse(result.intervals[0].start),
    34 * 3_600_000,
  );
});
test("tokens cambian sólo con calendario activo y el contexto es una instantánea", () => {
  const source = calendar(),
    from = "2026-11-17T10:00:00-03:00",
    to = "2026-11-17T11:00:00-03:00";
  const original = preview(from, to, source),
    saved = createKm100Context(original);
  source.years[2026].version++;
  source.years[2026].lastCheckedAt = new Date().toISOString();
  assert.equal(preview(from, to, source).calendarToken, original.calendarToken);
  source.years[2026].entries.push(entry("2026-11-17"));
  source.years[2026].revision++;
  assert.notEqual(
    preview(from, to, source).calendarToken,
    original.calendarToken,
  );
  assert.equal(parseKm100Context(saved)?.mode, "NONE");
  assert.throws(() => parseKm100Context("invalid"), {
    code: "KM100_CONTEXT_INVALID",
  });
  assert.throws(() => parseKm100Context(""), { code: "KM100_CONTEXT_INVALID" });
  assert.equal(parseKm100Context(null), null);
});
test("calendario validado rechaza duplicados, años mezclados y fechas imposibles", () => {
  assert.equal(
    holidayCalendarSchema.safeParse(calendar([2026], [entry("2026-02-30")]))
      .success,
    false,
  );
  assert.equal(
    holidayCalendarSchema.safeParse(
      calendar([2026], [entry("2026-01-01"), entry("2026-01-01")]),
    ).success,
    false,
  );
  const wrong = calendar();
  wrong.years[2026].entries.push(entry("2027-01-01"));
  assert.equal(holidayCalendarSchema.safeParse(wrong).success, false);
});
test("propuestas conservan manuales, ediciones y eliminaciones administrativas", () => {
  const state = emptyHolidayYear(2026);
  state.officialBaseline = [
    entry("2026-01-01", "Anterior"),
    entry("2026-05-01", "Eliminado"),
    entry("2026-07-09", "Sin editar"),
  ];
  state.entries = [
    entry("2026-01-01", "Nombre corregido", false),
    entry("2026-07-09", "Sin editar"),
    { ...entry("2026-02-02", "Local"), source: "manual" },
  ];
  const result = mergeOfficialEntries(state, [
    entry("2026-01-01", "Nuevo"),
    entry("2026-05-01", "Eliminado"),
    entry("2026-07-09", "Actualizado"),
    entry("2026-12-25", "Nuevo feriado"),
  ]);
  assert.deepEqual(
    result.find((item) => item.date === "2026-01-01"),
    state.entries[0],
  );
  assert.equal(
    result.some((item) => item.date === "2026-05-01"),
    false,
  );
  assert.equal(
    result.find((item) => item.date === "2026-07-09")?.name,
    "Actualizado",
  );
  assert.equal(
    result.find((item) => item.date === "2026-02-02")?.source,
    "manual",
  );
});

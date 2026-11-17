import test from "node:test";
import assert from "node:assert/strict";
import { statutoryHolidayEntries } from "../src/holiday-preload.js";

// Calendar fixtures independently checked against Ley 27.399's weekday rules
// and the Easter dates published by Census/USNO (no network calls in tests).
const expectedYears = {
  2027: [
    "01-01",
    "02-08",
    "02-09",
    "03-24",
    "03-26",
    "04-02",
    "05-01",
    "05-25",
    "06-20",
    "06-21",
    "07-09",
    "08-16",
    "10-11",
    "11-20",
    "12-08",
    "12-25",
  ],
  2028: [
    "01-01",
    "02-28",
    "02-29",
    "03-24",
    "04-02",
    "04-14",
    "05-01",
    "05-25",
    "06-17",
    "06-20",
    "07-09",
    "08-21",
    "10-16",
    "11-20",
    "12-08",
    "12-25",
  ],
  2029: [
    "01-01",
    "02-12",
    "02-13",
    "03-24",
    "03-30",
    "04-02",
    "05-01",
    "05-25",
    "06-17",
    "06-20",
    "07-09",
    "08-20",
    "10-15",
    "11-19",
    "12-08",
    "12-25",
  ],
  2030: [
    "01-01",
    "03-04",
    "03-05",
    "03-24",
    "04-02",
    "04-19",
    "05-01",
    "05-25",
    "06-17",
    "06-20",
    "07-09",
    "08-17",
    "10-12",
    "11-18",
    "12-08",
    "12-25",
  ],
};

for (const [year, dates] of Object.entries(expectedYears)) {
  test(`base normativa ${year}: fechas completas y traslados legales`, () => {
    assert.deepEqual(
      statutoryHolidayEntries(Number(year)).map((entry) => entry.date),
      dates.map((date) => `${year}-${date}`),
    );
  });
}

test("no presume traslados de sábados/domingo ni agrega puentes o excepciones", () => {
  const saturday = statutoryHolidayEntries(2027);
  assert.ok(saturday.some((entry) => entry.date === "2027-11-20"));
  assert.equal(
    saturday.some((entry) => ["2027-11-19", "2027-11-22"].includes(entry.date)),
    false,
  );
  const sunday = statutoryHolidayEntries(2029);
  assert.ok(sunday.some((entry) => entry.date === "2029-06-17"));
  assert.equal(
    sunday.some((entry) => ["2029-06-15", "2029-06-18"].includes(entry.date)),
    false,
  );
  for (const year of [2027, 2028, 2029, 2030, 2031, 2040, 2100, 2200]) {
    const entries = statutoryHolidayEntries(year);
    assert.equal(
      entries.some(
        (entry) =>
          entry.name.includes("turíst") ||
          entry.name.includes("Papa") ||
          entry.name.includes("Jueves Santo"),
      ),
      false,
    );
  }
});

test("móviles religiosos siguen funcionando después de 2030 y en siglos no bisiestos", () => {
  const fixtures = [
    [2031, "02-24", "02-25", "04-11"],
    [2040, "02-13", "02-14", "03-30"],
    [2100, "02-08", "02-09", "03-26"],
    [2200, "02-17", "02-18", "04-04"],
    [9999, "02-08", "02-09", "03-26"],
  ] as const;
  for (const [year, monday, tuesday, friday] of fixtures) {
    const entries = statutoryHolidayEntries(year);
    const namedDate = (name: string) =>
      entries.find((entry) => entry.name.includes(name))?.date;
    assert.equal(namedDate("Lunes de Carnaval"), `${year}-${monday}`);
    assert.equal(namedDate("Martes de Carnaval"), `${year}-${tuesday}`);
    assert.equal(namedDate("Viernes Santo"), `${year}-${friday}`);
  }
});

test("feriados coincidentes comparten una fecha y conservan ambos nombres", () => {
  const transferred = statutoryHolidayEntries(2033);
  const june20 = transferred.filter((entry) => entry.date === "2033-06-20");
  assert.equal(june20.length, 1);
  assert.match(june20[0].name, /Belgrano/);
  assert.match(june20[0].name, /Güemes/);
  assert.equal(transferred.length, 15);
  const religious = statutoryHolidayEntries(2062);
  const march24 = religious.filter((entry) => entry.date === "2062-03-24");
  assert.equal(march24.length, 1);
  assert.match(march24[0].name, /Memoria/);
  assert.match(march24[0].name, /Viernes Santo/);
  assert.equal(religious.length, 15);
});

test("fechas ordenadas, únicas, válidas y de cuatro dígitos en todo el rango admitido", () => {
  for (const year of [2027, 2031, 2040, 2100, 2200, 2400, 9999]) {
    const entries = statutoryHolidayEntries(year);
    const dates = entries.map((entry) => entry.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(new Set(dates).size, dates.length);
    assert.equal(
      entries.reduce(
        (count, entry) => count + entry.name.split(" / ").length,
        0,
      ),
      16,
    );
    for (const entry of entries) {
      assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(entry.date.slice(0, 4), String(year));
      assert.equal(
        new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10),
        entry.date,
      );
      assert.ok(entry.name.length > 0 && entry.name.length <= 180);
      assert.equal(entry.source, "official");
      assert.equal(entry.enabled, true);
    }
  }
});

test("rechaza años fuera del rango o no enteros, sin coerción", () => {
  for (const year of [0, 1900, 2026, 2027.5, 10000, NaN, Infinity, -Infinity])
    assert.throws(() => statutoryHolidayEntries(year), RangeError);
  assert.throws(
    () => statutoryHolidayEntries("2027" as unknown as number),
    RangeError,
  );
});

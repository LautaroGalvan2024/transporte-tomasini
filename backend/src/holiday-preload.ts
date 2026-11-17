import type { HolidayEntry } from "./holiday-domain.js";

export const STATUTORY_SOURCE_URL =
  "https://www.argentina.gob.ar/normativa/nacional/ley-27399-281835/texto";

// This is a proposal calculated from the currently published recurring rules,
// not an annually published calendar. It never includes guessed tourist days,
// local holidays, extraordinary decrees, or discretionary weekend transfers.
const fixedHolidays = [
  [1, 1, "Año Nuevo"],
  [3, 24, "Día Nacional de la Memoria por la Verdad y la Justicia"],
  [4, 2, "Día del Veterano y de los Caídos en la Guerra de Malvinas"],
  [5, 1, "Día del Trabajador"],
  [5, 25, "Día de la Revolución de Mayo"],
  [6, 20, "Paso a la Inmortalidad del General Manuel Belgrano"],
  [7, 9, "Día de la Independencia"],
  [12, 8, "Día de la Inmaculada Concepción de María"],
  [12, 25, "Navidad"],
] as const;
const transferableHolidays = [
  [6, 17, "Paso a la Inmortalidad del General Martín Miguel de Güemes"],
  [8, 17, "Paso a la Inmortalidad del General José de San Martín"],
  [10, 12, "Día del Respeto a la Diversidad Cultural"],
  [11, 20, "Día de la Soberanía Nacional"],
] as const;

// Gregorian Easter: integer algorithm by J.-M. Oudin (1940), as published by
// the U.S. Naval Observatory: https://aa.usno.navy.mil/faq/easter . These dates
// follow the ecclesiastical calendar, not astronomical full-moon observations.
function easterSunday(year: number): Date {
  const div = Math.floor;
  const century = div(year / 100);
  const goldenNumber = year - 19 * div(year / 19);
  const correction = div((century - 17) / 25);
  let epact =
    century -
    div(century / 4) -
    div((century - correction) / 3) +
    19 * goldenNumber +
    15;
  epact -= 30 * div(epact / 30);
  epact -=
    div(epact / 28) *
    (1 -
      div(epact / 28) * div(29 / (epact + 1)) * div((21 - goldenNumber) / 11));
  let weekday = year + div(year / 4) + epact + 2 - century + div(century / 4);
  weekday -= 7 * div(weekday / 7);
  const difference = epact - weekday;
  const month = 3 + div((difference + 40) / 44);
  const day = difference + 28 - 31 * div(month / 4);
  return new Date(Date.UTC(year, month - 1, day));
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function statutoryHolidayEntries(year: number): HolidayEntry[] {
  if (!Number.isInteger(year) || year < 2027 || year > 9999)
    throw new RangeError(
      "La base normativa admite años enteros entre 2027 y 9999.",
    );

  const entries = new Map<string, HolidayEntry>();
  const add = (date: Date, name: string) => {
    const key = date.toISOString().slice(0, 10);
    const previous = entries.get(key);
    entries.set(key, {
      date: key,
      name: previous ? `${previous.name} / ${name}` : name,
      source: "official",
      enabled: true,
    });
  };
  for (const [month, day, name] of fixedHolidays)
    add(new Date(Date.UTC(year, month - 1, day)), name);

  const easter = easterSunday(year);
  add(plusDays(easter, -48), "Lunes de Carnaval");
  add(plusDays(easter, -47), "Martes de Carnaval");
  add(plusDays(easter, -2), "Viernes Santo");

  // Ley 27.399, art. 6: Tuesday/Wednesday -> preceding Monday;
  // Thursday/Friday -> following Monday. Monday stays on its original date.
  // Decreto 614/2025 makes Saturday/Sunday transfers discretionary, so retain
  // their original date until an annual official publication says otherwise:
  // https://www.argentina.gob.ar/normativa/nacional/decreto-614-2025-416911/texto
  for (const [month, day, name] of transferableHolidays) {
    const original = new Date(Date.UTC(year, month - 1, day));
    const weekday = original.getUTCDay();
    const delta =
      weekday === 2 || weekday === 3
        ? 1 - weekday
        : weekday === 4 || weekday === 5
          ? 8 - weekday
          : 0;
    add(plusDays(original, delta), name);
  }

  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}

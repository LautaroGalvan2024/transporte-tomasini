import test from "node:test";
import assert from "node:assert/strict";
import {
  businessDay,
  businessHour,
  calculateStatus,
  nextMonthDate,
  validateReadings,
  validateTripDates,
} from "../src/domain.js";
import { validateDatabaseUrl } from "../src/config.js";
import { hashPassword, verifyPassword } from "../src/password.js";
import { day } from "../src/validation.js";

test("Argentina conserva el día local en el cambio de fecha UTC", () => {
  assert.equal(businessDay(new Date("2026-11-03T02:59:00Z")), "2026-11-02");
  assert.equal(businessDay(new Date("2026-11-03T03:00:00Z")), "2026-11-03");
  assert.equal(businessHour(new Date("2026-11-03T11:00:00Z")), 8);
});
test("vence al alcanzar cualquiera de los dos límites, incluidas igualdades", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const item = {
    dueDate: new Date("2026-12-02"),
    dueKm: 10000,
    warningDays: 10,
    warningKm: 500,
  };
  assert.equal(calculateStatus(item, 10000, now).status, "OVERDUE");
  assert.equal(
    calculateStatus({ ...item, dueDate: new Date("2026-11-02") }, 8000, now)
      .status,
    "OVERDUE",
  );
  assert.equal(calculateStatus(item, 9500, now).status, "UPCOMING");
  assert.equal(
    calculateStatus({ ...item, dueDate: new Date("2026-11-12") }, 8000, now)
      .status,
    "UPCOMING",
  );
  assert.equal(calculateStatus(item, 9000, now).status, "OK");
  assert.equal(
    calculateStatus({ ...item, dueDate: null, dueKm: null }, 9000, now).status,
    "UNCONFIGURED",
  );
  assert.equal(
    calculateStatus({ ...item, intervalMonths: 6, dueDate: null }, 8000, now)
      .status,
    "UNCONFIGURED",
  );
  assert.equal(
    calculateStatus({ ...item, intervalMonths: 6, dueDate: null }, 10000, now)
      .status,
    "OVERDUE",
  );
});
test("fin de mes y año bisiesto conservan vencimientos de calendario válidos", () => {
  assert.equal(nextMonthDate("2026-01-31", 1), "2026-02-28");
  assert.equal(nextMonthDate("2024-01-31", 1), "2024-02-29");
  assert.equal(nextMonthDate("2024-02-29", 12), "2025-02-28");
  assert.equal(day.safeParse("2026-02-30").success, false);
});
test("historial admite carga fuera de orden y movimientos entre viajes, rechaza regresiones", () => {
  const reading = (date: string, km: number) => ({
    at: new Date(date),
    km,
    label: "lectura",
  });
  assert.doesNotThrow(() =>
    validateReadings([
      reading("2026-10-03", 1400),
      reading("2026-10-01", 1000),
      reading("2026-10-02", 1200),
    ]),
  );
  assert.throws(
    () =>
      validateReadings([
        reading("2026-10-01", 1000),
        reading("2026-10-02", 900),
      ]),
    /historial/,
  );
  assert.throws(
    () =>
      validateReadings([
        reading("2026-10-01", 1000),
        reading("2026-10-01", 1200),
      ]),
    /historial/,
  );
});
test("viajes completados rechazan fechas futuras, orden invertido y kilómetros negativos", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const valid = {
    departureAt: new Date("2026-11-01T12:00:00Z"),
    arrivalAt: new Date("2026-11-01T13:00:00Z"),
    startKm: 100,
    endKm: 200,
  };
  assert.doesNotThrow(() => validateTripDates(valid, now));
  assert.throws(() => validateTripDates({ ...valid, endKm: 99 }, now));
  assert.throws(() =>
    validateTripDates({ ...valid, arrivalAt: new Date("2026-11-03") }, now),
  );
  assert.throws(() =>
    validateTripDates({ ...valid, arrivalAt: valid.departureAt }, now),
  );
});
test("destino SQL exige nombre y rol funcional de Tomasini, rechaza migrador en runtime", () => {
  assert.equal(
    validateDatabaseUrl(
      "postgresql://tomasini_dev_app:secret@localhost/tomasini_dev?schema=tomasini",
    ).database,
    "tomasini_dev",
  );
  for (const url of [
    "postgresql://postgres:secret@localhost/tomasini_dev",
    "postgresql://tomasini_dev_migrator:secret@localhost/tomasini_dev",
    "postgresql://tomasini_dev_app:secret@localhost/horizontes",
    "postgresql://tomasini_dev_app:secret@localhost/tomasini_dev?schema=public",
    "postgresql://tomasini_dev_app:secret@localhost/tomasini_dev?options=-csearch_path%3Dpublic",
  ])
    assert.throws(() => validateDatabaseUrl(url));
});
test("scrypt verifica contraseñas, sal aleatoria y hash malformado sin aceptar parámetros arbitrarios", async () => {
  const first = await hashPassword("Una-clave-larga-para-prueba");
  const second = await hashPassword("Una-clave-larga-para-prueba");
  assert.notEqual(first, second);
  assert.equal(
    await verifyPassword("Una-clave-larga-para-prueba", first),
    true,
  );
  assert.equal(await verifyPassword("Contraseña-equivocada", first), false);
  assert.equal(
    await verifyPassword(
      "Una-clave-larga-para-prueba",
      first.replace("16384", "1073741824"),
    ),
    false,
  );
  assert.equal(await verifyPassword("x".repeat(129), first), false);
  await assert.rejects(hashPassword("corta"));
});

import test from "node:test";
import assert from "node:assert/strict";
import { validateAdjustedHistory } from "../src/odometer.js";

const at = (day: number) =>
  new Date(`2026-01-${String(day).padStart(2, "0")}T12:00:00Z`);
const reading = (day: number, km: number) => ({
  at: at(day),
  km,
  label: "lectura",
});

test("Las correcciones separan lecturas sin reescribir ni relajar cada tramo", () => {
  const changes = [reading(3, 500), reading(6, 2500)];
  const readings = [
    reading(1, 1000),
    reading(2, 1200),
    reading(4, 600),
    reading(7, 2600),
  ];
  assert.doesNotThrow(() => validateAdjustedHistory(readings, changes, []));
  assert.throws(
    () => validateAdjustedHistory([...readings, reading(5, 550)], changes, []),
    /no coinciden/,
  );
  assert.throws(
    () => validateAdjustedHistory([...readings, reading(1, 900)], changes, []),
    /no coinciden/,
  );
  assert.throws(
    () => validateAdjustedHistory([...readings, reading(7, 2400)], changes, []),
    /no coinciden/,
  );
});

test("Un viaje no cruza una corrección y su salida puede coincidir con la lectura nueva", () => {
  const changes = [reading(3, 500)];
  assert.throws(
    () =>
      validateAdjustedHistory([], changes, [
        { departureAt: at(2), arrivalAt: at(3) },
      ]),
    /abarca una corrección/,
  );
  assert.doesNotThrow(() =>
    validateAdjustedHistory([reading(3, 500), reading(4, 600)], changes, [
      { departureAt: at(3), arrivalAt: at(4) },
    ]),
  );
  assert.throws(
    () => validateAdjustedHistory([reading(3, 499)], changes, []),
    /no coinciden/,
  );
});

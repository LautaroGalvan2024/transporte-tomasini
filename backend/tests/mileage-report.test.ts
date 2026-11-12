import { test } from "node:test";
import assert from "node:assert/strict";
import { strFromU8, unzipSync } from "fflate";
import { mileageReport, type MileageTrip } from "../src/mileage-report.js";

const trip: MileageTrip = {
  driverId: "driver-a",
  truckId: "truck-a",
  driver: { user: { name: "Chofer / de prueba" } },
  truck: { plate: "QA001ZZ" },
  departureAt: new Date("2026-09-01T02:45:00Z"),
  arrivalAt: new Date("2026-09-01T05:30:00Z"),
  origin: "=1+2",
  destination: "Destino",
  startKm: 1200,
  endKm: 1372,
  controlCount: 0,
};

test("la planilla usa fechas y horas argentinas y conserva cero, faltantes y texto literal", async () => {
  const files = unzipSync(
    await mileageReport([trip, { ...trip, controlCount: null }]),
  );
  const strings = strFromU8(files["xl/sharedStrings.xml"]);
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(strings, /Control de\nDescarga/);
  assert.match(strings, /=1\+2/);
  assert.match(sheet, /<c r="C5"[^>]* t="s">/);
  assert.match(sheet, /<c r="G5"[^>]*><v>172<\/v>/);
  assert.match(sheet, /<c r="J5"[^>]*><v>0<\/v>/);
  assert.match(sheet, /<c r="J6"[^>]*\/>/);
  for (const letter of ["H", "I", "K", "L"])
    assert.match(sheet, new RegExp('<c r="' + letter + '5"[^>]*\\/>'));
  const getNumber = (cell: string) =>
    Number(
      new RegExp('<c r="' + cell + '"[^>]*><v>([^<]+)</v>').exec(sheet)?.[1],
    );
  const excelEpoch = Date.UTC(1899, 11, 30);
  assert.equal(
    getNumber("A5"),
    (Date.UTC(2026, 7, 31) - excelEpoch) / 86_400_000,
  );
  assert.equal(getNumber("B5"), (23 * 60 + 45) / 1440);
  assert.equal(
    getNumber("D5"),
    (Date.UTC(2026, 8, 1) - excelEpoch) / 86_400_000,
  );
  assert.equal(getNumber("E5"), (2 * 60 + 30) / 1440);
  assert.match(sheet, /COUNT\(J5:J28\)=COUNT\(A5:A28\)/);
  assert.match(sheet, /fitToPage="1"/);
  assert.match(
    sheet,
    /paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="1"/,
  );
});

test("cada folio conserva un chofer, un mes y una patente incluso con más de 24 viajes", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    ...trip,
    controlCount: i,
  }));
  rows.push(
    {
      ...trip,
      truckId: "truck-b",
      truck: { plate: "QA002ZZ" },
      controlCount: 26,
    },
    { ...trip, driverId: "driver-b", controlCount: 27 },
    {
      ...trip,
      departureAt: new Date("2026-09-01T08:00:00Z"),
      arrivalAt: new Date("2026-09-01T10:00:00Z"),
      controlCount: 28,
    },
  );
  const files = unzipSync(await mileageReport(rows));
  const sheets = Object.keys(files).filter((key) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(key),
  );
  assert.equal(sheets.length, 5);
  const workbook = strFromU8(files["xl/workbook.xml"]);
  assert.match(workbook, /2026-08 Chofer/);
  assert.match(workbook, /2026-09 Chofer/);
  assert.match(strFromU8(files[sheets[0]]), /<c r="J28"[^>]*><v>23<\/v>/);
  for (const [index, expected] of [24, 26, 27, 28].entries()) {
    assert.match(
      strFromU8(files[sheets[index + 1]]),
      new RegExp('<c r="J5"[^>]*><v>' + expected + "</v>"),
    );
  }
});

test("filtros sin viajes devuelven un formulario vacío y los rangos excesivos se pueden acotar", async () => {
  const files = unzipSync(await mileageReport([]));
  assert.match(strFromU8(files["xl/workbook.xml"]), /Planilla de km/);
  assert.doesNotMatch(
    strFromU8(files["xl/sharedStrings.xml"]),
    /QA001ZZ|Chofer \/ de prueba/,
  );
  const oversized = Array.from({ length: 251 }, (_, i) => ({
    ...trip,
    driverId: String(i),
  }));
  assert.throws(() => mileageReport(oversized), /Acotá el período/);
});

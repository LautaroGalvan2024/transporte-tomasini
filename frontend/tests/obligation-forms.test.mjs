import assert from "node:assert/strict";
import test from "node:test";
import {
  addMonths,
  obligationFormDefaults,
  renewalFormDefaults,
  buildObligationPayload,
  buildRenewalPayload,
  obligationErrorStep,
  renewalErrorStep,
} from "../src/features/admin/obligation-forms.ts";

const performedAt = "2026-11-18T08:30";
const obligation = (overrides = {}) => ({
  id: "obligation-1",
  title: "Seguro",
  kind: "DOCUMENT",
  truckId: "truck-1",
  trailerId: null,
  driverId: null,
  dueDate: "2026-12-31",
  dueKm: null,
  intervalMonths: 12,
  intervalKm: null,
  warningDays: 15,
  warningKm: 500,
  notes: null,
  active: true,
  version: 7,
  ownerActive: true,
  status: "OK",
  daysRemaining: 43,
  kmRemaining: null,
  odometerMissing: false,
  ...overrides,
});

test("el alta conserva los valores de respaldo si la configuración no estaba cargada", () => {
  const initial = obligationFormDefaults(null, null, performedAt);
  assert.deepEqual(initial, {
    kind: "SERVICE",
    title: "",
    ownerType: "truck",
    ownerId: "",
    dueDate: "",
    dueKm: "",
    intervalMonths: "",
    intervalKm: "",
    warningDays: "30",
    warningKm: "1000",
    notes: "",
    active: true,
    initialRecord: false,
    performedAt,
    odometer: "",
  });
  const later = obligationFormDefaults(
    null,
    { warningDays: 15, warningKm: 500 },
    performedAt,
  );
  assert.equal(later.warningDays, "15");
  assert.equal(later.warningKm, "500");
  assert.equal(initial.warningDays, "30");
  assert.equal(initial.warningKm, "1000");
});

test("los valores guardados prevalecen sobre la configuración y conservan cero e inactivo", () => {
  const initial = obligationFormDefaults(
    obligation({
      truckId: null,
      trailerId: "trailer-1",
      warningDays: 0,
      warningKm: 0,
      dueKm: 0,
      intervalMonths: null,
      active: false,
      notes: "Texto guardado",
    }),
    { warningDays: 20, warningKm: 2000 },
    performedAt,
  );
  assert.equal(initial.ownerType, "trailer");
  assert.equal(initial.ownerId, "trailer-1");
  assert.equal(initial.warningDays, "0");
  assert.equal(initial.warningKm, "0");
  assert.equal(initial.dueKm, "0");
  assert.equal(initial.intervalMonths, "");
  assert.equal(initial.active, false);
  assert.equal(initial.notes, "Texto guardado");
  assert.equal(initial.dueDate, "2026-12-31");
  assert.equal(
    obligationFormDefaults(
      obligation({ truckId: null, driverId: "driver-1" }),
      null,
      performedAt,
    ).ownerType,
    "driver",
  );
});

test("el alta de servicio de camión conserva el payload, los ceros y el instante argentino", () => {
  const values = Object.freeze({
    ...obligationFormDefaults(null, null, performedAt),
    title: "  Cambio de aceite  ",
    ownerId: "truck-1",
    dueKm: "0",
    intervalKm: "10000",
    warningDays: "0",
    warningKm: "0",
    notes: "  Revisar filtros  ",
    initialRecord: true,
    odometer: "0",
  });
  assert.deepEqual(buildObligationPayload(values, null), {
    title: "Cambio de aceite",
    kind: "SERVICE",
    truckId: "truck-1",
    trailerId: null,
    driverId: null,
    dueDate: null,
    dueKm: 0,
    intervalMonths: null,
    intervalKm: 10000,
    warningDays: 0,
    warningKm: 0,
    notes: "Revisar filtros",
    initialRecord: { performedAt: "2026-11-18T11:30:00.000Z", odometer: 0 },
  });
  assert.equal(values.title, "  Cambio de aceite  ");
});

test("los campos kilométricos se omiten como nulos para acoplados y choferes", () => {
  for (const ownerType of ["trailer", "driver"]) {
    const values = {
      ...obligationFormDefaults(null, null, performedAt),
      ownerType,
      ownerId: `${ownerType}-1`,
      dueKm: "150",
      intervalKm: "100",
      initialRecord: true,
      odometer: "50",
      notes: "   ",
      kind: ownerType === "trailer" ? "SERVICE" : "DOCUMENT",
    };
    const result = buildObligationPayload(values, null);
    assert.equal(result[`${ownerType}Id`], `${ownerType}-1`);
    assert.equal(result.truckId, null);
    assert.equal(result.dueKm, null);
    assert.equal(result.intervalKm, null);
    assert.equal(result.notes, null);
    if (ownerType === "trailer")
      assert.equal(result.initialRecord.odometer, null);
    else assert.equal(Object.hasOwn(result, "initialRecord"), false);
  }
});

test("editar conserva versionado y estado sin agregar un registro inicial", () => {
  const stored = obligation({ kind: "SERVICE" });
  const values = {
    ...obligationFormDefaults(stored, null, performedAt),
    active: false,
    initialRecord: true,
    odometer: "123",
  };
  const result = buildObligationPayload(values, stored);
  assert.equal(result.version, 7);
  assert.equal(result.active, false);
  assert.equal(Object.hasOwn(result, "initialRecord"), false);
  const create = buildObligationPayload(values, null);
  assert.equal(Object.hasOwn(create, "version"), false);
  assert.equal(Object.hasOwn(create, "active"), false);
});

test("los números opcionales vacíos siguen siendo nulos y las advertencias usan Number", () => {
  const result = buildObligationPayload(
    {
      ...obligationFormDefaults(null, null, performedAt),
      dueKm: " ",
      intervalMonths: " ",
      intervalKm: "",
      warningDays: "",
      warningKm: "",
      initialRecord: true,
      odometer: " ",
    },
    null,
  );
  assert.equal(result.dueKm, null);
  assert.equal(result.intervalMonths, null);
  assert.equal(result.intervalKm, null);
  assert.equal(result.initialRecord.odometer, null);
  assert.equal(result.warningDays, 0);
  assert.equal(result.warningKm, 0);
});

test("la renovación inicial conserva la sugerencia desde hoy y el ajuste de fin de mes", () => {
  assert.deepEqual(
    renewalFormDefaults({ intervalMonths: 1 }, performedAt, "2024-01-31"),
    {
      performedAt,
      odometer: "",
      nextDueDate: "2024-02-29",
      nextDueKm: "",
      notes: "",
    },
  );
  assert.equal(
    renewalFormDefaults({ intervalMonths: null }, performedAt, "2024-01-31")
      .nextDueDate,
    "",
  );
  assert.equal(addMonths("2023-01-31T09:15", 1), "2023-02-28");
  assert.equal(addMonths("2026-12-31", 2), "2027-02-28");
  for (const months of [0, -1, 1.5, 121])
    assert.equal(addMonths("2026-01-01", months), "");
  assert.equal(addMonths("", 1), "");
});

test("la renovación distingue servicio de camión, documento y acoplado sin perder cero", () => {
  const values = Object.freeze({
    performedAt,
    odometer: "0",
    nextDueDate: "",
    nextDueKm: "0",
    notes: "  ",
  });
  assert.deepEqual(
    buildRenewalPayload(values, obligation({ kind: "SERVICE" })),
    {
      performedAt: "2026-11-18T11:30:00.000Z",
      odometer: 0,
      nextDueDate: null,
      nextDueKm: 0,
      notes: null,
      version: 7,
    },
  );
  const document = buildRenewalPayload(values, obligation());
  assert.equal(document.odometer, null);
  assert.equal(document.nextDueKm, 0);
  const trailer = buildRenewalPayload(
    values,
    obligation({ kind: "SERVICE", truckId: null }),
  );
  assert.equal(trailer.odometer, null);
  assert.equal(trailer.nextDueKm, null);
});

test("los errores de vencimiento mantienen prioridad Datos antes de Programación", () => {
  for (const field of [
    "title",
    "kind",
    "truckId",
    "trailerId",
    "driverId",
    "notes",
  ])
    assert.equal(obligationErrorStep({ [field]: "error" }, 2), 0, field);
  for (const field of [
    "dueDate",
    "dueKm",
    "intervalMonths",
    "intervalKm",
    "warningDays",
    "warningKm",
  ])
    assert.equal(obligationErrorStep({ [field]: "error" }, 2), 1, field);
  assert.equal(
    obligationErrorStep({ warningKm: "error", notes: "error" }, 2),
    0,
  );
  for (const fields of [
    {},
    { "initialRecord.performedAt": "error" },
    { "initialRecord.odometer": "error" },
    { version: "error" },
    { unknown: "error" },
  ])
    assert.equal(obligationErrorStep(fields, 2), 2);
  assert.equal(obligationErrorStep(JSON.parse('{"__proto__":"error"}'), 2), 2);
});

test("los errores de renovación vuelven al registro solo para sus campos", () => {
  for (const field of ["performedAt", "odometer", "notes"])
    assert.equal(renewalErrorStep({ [field]: "error" }, 1), 0, field);
  for (const fields of [
    {},
    { nextDueDate: "error" },
    { nextDueKm: "error" },
    { version: "error" },
    { unknown: "error" },
  ])
    assert.equal(renewalErrorStep(fields, 1), 1);
  assert.equal(
    renewalErrorStep({ nextDueDate: "error", odometer: "error" }, 1),
    0,
  );
});

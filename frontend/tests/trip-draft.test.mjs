import assert from "node:assert/strict";
import test from "node:test";
import {
  draftMileage,
  emptyValues,
  reuseTripAttempt,
  tripErrorSection,
  tripFromDraft,
  tripPreviewRequest,
  tripSaveFailure,
  tripToDraft,
} from "../src/features/trips/trip-draft.ts";

const draft = (overrides = {}) => ({
  ...emptyValues(),
  truckId: "truck-one",
  driverId: "driver-one",
  origin: "  Rosario  ",
  destination: "  Córdoba  ",
  departureAt: "2026-11-14T12:00",
  arrivalAt: "2026-11-14T13:00",
  startKm: "1000",
  endKm: "1100",
  km100: "0",
  allowance: "125,50",
  notes: "  Entrega completa  ",
  ...overrides,
});
const context = (overrides = {}) => ({
  baseline: emptyValues(),
  savedTrip: null,
  role: "ADMIN",
  evaluateKm: true,
  preview: { calendarToken: "calendar-one" },
  resolveKm100: false,
  mode: { kind: "create", clientRequestId: "request-one" },
  ...overrides,
});

test("el alta conserva el JSON, orden, cero y conversiones del formulario", () => {
  const request = tripFromDraft(draft(), context());
  assert.equal(
    JSON.stringify(request),
    JSON.stringify({
      truckId: "truck-one",
      trailerId: null,
      driverId: "driver-one",
      origin: "Rosario",
      destination: "Córdoba",
      departureAt: "2026-11-14T15:00:00.000Z",
      arrivalAt: "2026-11-14T16:00:00.000Z",
      startKm: 1000,
      endKm: 1100,
      km100: 0,
      controlCount: 0,
      allowance: 125.5,
      notes: "Entrega completa",
      km100CalendarToken: "calendar-one",
      clientRequestId: "request-one",
    }),
  );
  assert.ok(Object.isFrozen(request));
});

test("editar sin recalcular omite km100 y conserva los instantes originales", () => {
  const values = draft({ controlCount: "", allowance: "", notes: "" });
  const savedTrip = {
    departureAt: "2026-11-14T15:00:47.123Z",
    arrivalAt: "2026-11-14T16:00:59.456Z",
  };
  const request = tripFromDraft(
    values,
    context({
      baseline: { ...values },
      savedTrip,
      evaluateKm: false,
      role: "DRIVER",
      mode: { kind: "update", version: 7 },
    }),
  );
  const wire = JSON.parse(JSON.stringify(request));
  assert.deepEqual(wire, {
    truckId: "truck-one",
    trailerId: null,
    origin: "Rosario",
    destination: "Córdoba",
    ...savedTrip,
    startKm: 1000,
    endKm: 1100,
    controlCount: null,
    allowance: null,
    notes: null,
    version: 7,
  });
  assert.ok(!("clientRequestId" in wire));
  assert.ok(!("driverId" in wire));
  assert.ok(!("km100CalendarToken" in wire));
});

test("la resolución de km100 conserva token, acoplado y control explícito cero", () => {
  const request = tripFromDraft(
    draft({ trailerId: "trailer-one" }),
    context({
      resolveKm100: true,
      mode: { kind: "update", version: 2 },
    }),
  );
  assert.equal(request.km100Resolve, true);
  assert.equal(request.km100CalendarToken, "calendar-one");
  assert.equal(request.trailerId, "trailer-one");
  assert.equal(request.controlCount, 0);
  assert.equal(request.km100, 0);
});

test("preview y guardado utilizan los mismos instantes y odómetros", () => {
  const values = draft();
  const baseline = { ...values };
  const stored = {
    departureAt: "2026-11-14T15:00:47.123Z",
    arrivalAt: "2026-11-14T16:00:59.456Z",
  };
  const preview = tripPreviewRequest(values, baseline, stored);
  const request = tripFromDraft(
    values,
    context({ baseline, savedTrip: stored }),
  );
  assert.deepEqual(preview, {
    ...stored,
    startKm: 1000,
    endKm: 1100,
  });
  for (const key of Object.keys(preview))
    assert.equal(request[key], preview[key]);
});

test("un intento ambiguo reutiliza su snapshot y UUID sin reconstruir el body", () => {
  const values = draft();
  const pending = tripFromDraft(values, context());
  const originalJson = JSON.stringify(pending);
  values.destination = "Otro destino";
  const replay = reuseTripAttempt(pending, () => {
    assert.fail("Un reintento no debe reconstruir el request");
  });
  assert.equal(replay, pending);
  assert.equal(JSON.stringify(replay), originalJson);
  assert.throws(() => {
    replay.clientRequestId = "changed";
  }, TypeError);
  const next = reuseTripAttempt(null, () =>
    tripFromDraft(
      values,
      context({
        mode: { kind: "create", clientRequestId: "request-two" },
      }),
    ),
  );
  assert.equal(next.clientRequestId, "request-two");
  assert.equal(next.destination, "Otro destino");
});

test("la recuperación distingue red, servidor, validación, versión y calendario", () => {
  for (const status of [0, 500, 503]) {
    const failure = tripSaveFailure({ status, code: "", message: "Original" });
    assert.equal(failure.clearPending, false);
    assert.match(failure.message, /Reintentá el mismo envío/);
  }
  for (const status of [400, 401, 403, 409]) {
    const failure = tripSaveFailure({
      status,
      code: "VALIDATION",
      message: "Original",
    });
    assert.equal(failure.clearPending, true);
    assert.equal(failure.message, "Original");
  }
  assert.equal(
    tripSaveFailure({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "Versión",
    }).conflict,
    true,
  );
  assert.equal(
    tripSaveFailure({
      status: 409,
      code: "KM100_CALENDAR_CHANGED",
      message: "Calendario",
    }).refreshPreview,
    true,
  );
  assert.equal(tripErrorSection({ allowance: "Importe" }), "extras");
  assert.equal(tripErrorSection({ notes: "Texto", truckId: "Camión" }), "trip");
  assert.equal(tripErrorSection({}), "extras");
});

test("el borrador distingue valores históricos nulos de ceros informados", () => {
  const stored = {
    ...draft(),
    startKm: 0,
    endKm: 0,
    trailerId: null,
    notes: null,
    km100: null,
    controlCount: null,
    allowance: null,
  };
  const missing = tripToDraft(stored, (value) => value);
  assert.equal(missing.startKm, "0");
  assert.equal(missing.km100, "");
  assert.equal(missing.controlCount, "");
  assert.equal(missing.allowance, "");
  const reported = tripToDraft(
    { ...stored, km100: 0, controlCount: 0, allowance: "0.00" },
    (value) => value,
  );
  assert.equal(reported.km100, "0");
  assert.equal(reported.controlCount, "0");
  assert.equal(reported.allowance, "0.00");
});

test("el viaje cargado por distancia conserva cero sin crear lecturas de odómetro", () => {
  const stored = {
    ...draft(),
    mileageMode: "DISTANCE",
    distanceKm: 0,
    startKm: null,
    endKm: null,
  };
  const values = tripToDraft(stored, (instant) => instant);
  assert.equal(values.startKm, "");
  assert.equal(values.endKm, "");
  assert.equal(values.distanceKm, "0");
  assert.deepEqual(draftMileage(values), { distance: 0, errors: {} });
  for (const value of ["", " ", "-4", "7.5", "10000000"]) {
    const { distance, errors } = draftMileage({ ...values, distanceKm: value });
    assert.equal(distance, null);
    assert.ok(errors.distanceKm);
  }
});

test("preview y guardado envían únicamente los campos del método seleccionado", () => {
  const values = draft({ distanceKm: "350", mileageMode: "DISTANCE" });
  const preview = tripPreviewRequest(values, emptyValues());
  assert.equal(preview.mileageMode, "DISTANCE");
  assert.equal(preview.distanceKm, 350);
  assert.ok(!("startKm" in preview));
  assert.ok(!("endKm" in preview));
  for (const mode of [
    { kind: "create", clientRequestId: "new" },
    { kind: "update", version: 2 },
  ]) {
    const body = tripFromDraft(values, context({ mode }));
    assert.deepEqual(
      Object.fromEntries(Object.keys(preview).map((key) => [key, body[key]])),
      preview,
    );
    assert.ok(!("startKm" in body));
    assert.ok(!("endKm" in body));
  }
  const normal = tripFromDraft(
    { ...values, mileageMode: "ODOMETER" },
    context(),
  );
  assert.equal(normal.startKm, 1000);
  assert.equal(normal.endKm, 1100);
  assert.ok(!("mileageMode" in normal));
  assert.ok(!("distanceKm" in normal));
});

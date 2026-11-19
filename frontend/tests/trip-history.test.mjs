import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateDetailText,
  presentTripHistory,
  tripDetailPermissions,
} from "../src/features/trips/trip-history.ts";
import { tripRowPresentation } from "../src/features/trips/trip-presentation.ts";

test("la paginación conserva texto, espacios, saltos y pares Unicode completos", () => {
  for (const value of [
    "",
    "Texto breve",
    "palabra ".repeat(200),
    "uno\ndos\ntres\n".repeat(70),
    "x".repeat(419) + "🚚" + "y".repeat(500),
  ]) {
    const pages = paginateDetailText(value);
    assert.equal(pages.join(""), value);
    for (const page of pages) {
      assert.ok(page.length <= 420);
      assert.ok(!/^[\uDC00-\uDFFF]/.test(page));
      assert.ok(!/[\uD800-\uDBFF]$/.test(page));
    }
  }
});

test("el historial mantiene eventos legacy y expone cambios de acoplado y km100", () => {
  const events = [
    { id: "legacy", action: "CREATED", createdAt: "2026-01-01" },
    {
      id: "update",
      action: "UPDATED",
      createdAt: "2026-01-02",
      before: {
        trailerId: null,
        km100: 0,
        km100Context: { mode: "PENDING" },
      },
      after: {
        trailerId: "trailer",
        trailer: { plate: "ABC123" },
        km100: 0,
        km100Context: { mode: "NONE" },
      },
    },
    { id: "future", action: "FUTURE_ACTION", createdAt: "2026-01-03" },
  ];
  const [page] = presentTripHistory(events, String);
  assert.equal(page.length, 3);
  assert.equal(page[0].title, "Viaje registrado");
  assert.equal(page[0].trailerChange, "");
  assert.equal(page[0].km100Change, "");
  assert.equal(
    page[1].trailerChange,
    "Acoplado: Sin acoplado registrado → ABC123",
  );
  assert.equal(
    page[1].km100Change,
    "Km al 100%: 0 km (pendiente de validar) → 0 km",
  );
  assert.equal(page[2].title, "FUTURE_ACTION");
});

test("los motivos largos conservan todas las partes y el orden de los eventos", () => {
  const reason = "Motivo con espacios\ny saltos. ".repeat(80);
  const events = [
    { id: "one", action: "CREATED", reason: "Primero" },
    { id: "two", action: "CANCELLED", reason },
    { id: "three", action: "", reason: "Último" },
  ];
  const entries = presentTripHistory(events, String).flat();
  assert.equal(entries[0].reason, "Primero");
  assert.equal(entries.at(-1).title, "Cambio registrado");
  const parts = entries.filter(({ event }) => event.id === "two");
  assert.equal(parts.map((entry) => entry.reason).join(""), reason);
  assert.deepEqual(
    parts.map((entry) => entry.part),
    parts.map((_, index) => index + 1),
  );
  assert.ok(parts.every((entry) => entry.parts === parts.length));
});

test("las acciones conservan la matriz de rol, revisión y anulación", () => {
  for (const role of ["ADMIN", "DRIVER"]) {
    for (const status of ["ACTIVE", "CANCELLED"]) {
      for (const reviewedAt of [null, "2026-11-18"]) {
        const result = tripDetailPermissions({ status, reviewedAt }, role);
        if (status === "CANCELLED") {
          assert.deepEqual(result, {
            canEdit: false,
            canReview: false,
            canCancel: false,
            showClose: true,
          });
        } else if (role === "ADMIN") {
          assert.deepEqual(result, {
            canEdit: true,
            canReview: !reviewedAt,
            canCancel: true,
            showClose: false,
          });
        } else {
          assert.deepEqual(result, {
            canEdit: !reviewedAt,
            canReview: false,
            canCancel: false,
            showClose: Boolean(reviewedAt),
          });
        }
      }
    }
  }
});

test("tabla y tarjeta comparten datos preparados conservando sus textos distintos", () => {
  const calls = [];
  const row = tripRowPresentation(
    {
      departureAt: "2026-11-18T15:04:00.000Z",
      distanceKm: 1200,
      km100: 0,
      km100Context: { mode: "PENDING" },
      status: "ACTIVE",
      reviewedAt: null,
      driver: { name: "Chofer" },
      truck: { plate: "AAA123" },
      trailer: { plate: "BBB456" },
    },
    {
      date: (value) => {
        calls.push(value);
        return "18/11/2026";
      },
      kilometers: (value) => {
        calls.push(value);
        return String(value);
      },
    },
  );
  assert.deepEqual(calls, ["2026-11-18T15:04:00.000Z", 1200, 0]);
  assert.equal(row.date, "18/11/2026");
  assert.match(row.time, /^12:04(?:\s+p\.\s*m\.)?$/u);
  assert.equal(row.truckPlate, "AAA123");
  assert.equal(row.trailerLabel, "Acoplado BBB456");
  assert.equal(row.km100, "0");
  assert.equal(row.km100DesktopSuffix, " · por validar");
  assert.equal(row.km100MobileSuffix, " · pendiente de validar");
  assert.deepEqual(row.status, {
    tone: "neutral",
    icon: "pending",
    label: "Por revisar",
  });
});

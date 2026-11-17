import assert from "node:assert/strict";
import test from "node:test";
import { tripDateForRequest } from "../src/trip-date.ts";

test("editar notas conserva los segundos que cruzan el sábado a las 13:00", () => {
  const stored = {
    departureAt: "2024-06-15T15:59:30.123Z",
    arrivalAt: "2024-06-15T16:00:30.456Z",
  };
  const inputs = {
    departureAt: "2024-06-15T12:59",
    arrivalAt: "2024-06-15T13:00",
  };
  const request = {
    departureAt: tripDateForRequest(
      inputs.departureAt,
      inputs.departureAt,
      stored.departureAt,
    ),
    arrivalAt: tripDateForRequest(
      inputs.arrivalAt,
      inputs.arrivalAt,
      stored.arrivalAt,
    ),
  };
  assert.deepEqual(request, stored);
  const saturdayBoundary = Date.parse("2024-06-15T13:00:00-03:00");
  assert.ok(Date.parse(request.departureAt) < saturdayBoundary);
  assert.ok(Date.parse(request.arrivalAt) > saturdayBoundary);
});

test("editar km al 100% conserva el instante de Argentina durante el DST histórico", () => {
  // Buenos Aires used UTC-02 in January 2008. The form displays 13:30.
  const stored = "2008-01-05T15:30:47.500Z";
  assert.equal(
    tripDateForRequest("2008-01-05T13:30", "2008-01-05T13:30", stored),
    stored,
  );
});

test("cambiar solo una fecha conserva la otra y las cargas nuevas mantienen su horario argentino", () => {
  assert.equal(
    tripDateForRequest(
      "2026-11-14T18:00",
      "2026-11-14T17:00",
      "2026-11-14T20:00:35.000Z",
    ),
    "2026-11-14T21:00:00.000Z",
  );
  assert.equal(
    tripDateForRequest("2026-11-14T13:00"),
    "2026-11-14T16:00:00.000Z",
  );
});

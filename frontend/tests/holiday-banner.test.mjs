import assert from "node:assert/strict";
import test from "node:test";
import { selectHolidayBanner } from "../src/holiday-types.ts";

const year = (value, hasProposal = true, confirmedAt = null) => ({
  year: value,
  hasProposal,
  confirmedAt,
  lastCheckError: null,
});
const status = (overrides = {}) => ({
  currentYear: 2026,
  needsConfirmation: false,
  years: [
    year(2026, false, "2026-01-01T12:00:00Z"),
    ...[2027, 2028, 2029, 2030].map((value) => year(value)),
  ],
  ...overrides,
});

test("las propuestas futuras precargadas no muestran aviso global", () => {
  assert.equal(selectHolidayBanner(status()), null);
});

test("el año actual sin confirmar conserva su aviso aunque existan futuros", () => {
  assert.deepEqual(selectHolidayBanner(status({ needsConfirmation: true })), {
    year: 2026,
    kind: "unconfirmed",
  });
});

test("una propuesta del año actual confirmado muestra novedades", () => {
  assert.deepEqual(
    selectHolidayBanner(
      status({
        years: [
          year(2030),
          year(2026, true, "2026-01-01T12:00:00Z"),
          year(2025),
        ],
      }),
    ),
    { year: 2026, kind: "proposal" },
  );
});

test("las propuestas antiguas no dejan un aviso permanente después de cambiar el año", () => {
  assert.equal(
    selectHolidayBanner(
      status({
        currentYear: 2027,
        years: [
          year(2026),
          year(2027, false, "2027-01-01T12:00:00Z"),
          year(2028),
        ],
      }),
    ),
    null,
  );
});

test("al llegar enero el nuevo año argentino sin confirmar pasa a ser el aviso actual", () => {
  assert.deepEqual(
    selectHolidayBanner(status({ currentYear: 2027, needsConfirmation: true })),
    { year: 2027, kind: "unconfirmed" },
  );
});

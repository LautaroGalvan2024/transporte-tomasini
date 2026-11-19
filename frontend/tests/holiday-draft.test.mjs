import assert from "node:assert/strict";
import test from "node:test";
import {
  applyHolidayEntry,
  hasDuplicateHolidayDate,
  holidayEntriesKey,
  initialHolidayDraft,
  toggleHolidayEntry,
} from "../src/features/holidays/draft.ts";

const holiday = (date, overrides = {}) => ({
  date,
  name: `Día ${date}`,
  source: "manual",
  enabled: true,
  ...overrides,
});

test("editar conserva la identidad original aunque la lista se reordene y la fecha cambie", () => {
  const original = holiday("2026-06-20", { source: "official" });
  const previous = holiday("2026-01-01");
  const entries = Object.freeze([
    Object.freeze(original),
    Object.freeze(previous),
  ]);
  const updated = { ...original, date: "2026-02-01", name: "Fecha revisada" };
  const result = applyHolidayEntry(
    [previous, { ...original }],
    { kind: "existing", originalDate: original.date },
    updated,
  );
  assert.deepEqual(result, [previous, updated]);
  assert.deepEqual(entries, [original, previous]);
  assert.equal(result[1].source, "official");
});

test("la fecha original no se considera duplicada por usar otra referencia de objeto", () => {
  const entries = [holiday("2026-06-20"), holiday("2026-07-09")];
  assert.equal(
    hasDuplicateHolidayDate(entries, "2026-06-20", "2026-06-20"),
    false,
  );
  assert.equal(
    hasDuplicateHolidayDate(entries, "2026-07-09", "2026-06-20"),
    true,
  );
  assert.equal(hasDuplicateHolidayDate(entries, "2026-06-20", null), true);
  assert.equal(hasDuplicateHolidayDate(entries, "2026-12-15", null), false);
});

test("agregar y activar usan la fecha y preservan las otras entradas", () => {
  const existing = holiday("2026-07-09");
  const added = holiday("2026-01-01", { enabled: false });
  const entries = [existing];
  const result = applyHolidayEntry(entries, { kind: "new" }, added);
  assert.deepEqual(result, [added, existing]);
  assert.deepEqual(toggleHolidayEntry(result, added.date), [
    { ...added, enabled: true },
    existing,
  ]);
  assert.equal(result[0].enabled, false);
  assert.deepEqual(entries, [existing]);
});

test("comparar borradores ignora orden y conserva cambios de nombre, origen y habilitación", () => {
  const entries = [holiday("2026-06-20"), holiday("2026-01-01")];
  assert.equal(
    holidayEntriesKey(entries),
    holidayEntriesKey([...entries].reverse()),
  );
  for (const change of [
    { enabled: false },
    { name: "Cambio" },
    { source: "official" },
  ]) {
    assert.notEqual(
      holidayEntriesKey(entries),
      holidayEntriesKey([{ ...entries[0], ...change }, entries[1]]),
    );
  }
});

test("solo el año vacío sin confirmar adopta automáticamente la propuesta como borrador", () => {
  const proposed = [holiday("2026-07-09"), holiday("2026-01-01")];
  const proposal = { hash: "reviewed-hash", entries: proposed };
  assert.deepEqual(
    initialHolidayDraft({ confirmedAt: null, entries: [], proposal }),
    {
      entries: [...proposed].reverse(),
      proposalHash: proposal.hash,
    },
  );
  const saved = [holiday("2026-12-15")];
  for (const confirmedAt of [null, "2026-01-01T00:00:00Z"]) {
    assert.deepEqual(
      initialHolidayDraft({ confirmedAt, entries: saved, proposal }),
      {
        entries: saved,
        proposalHash: null,
      },
    );
  }
  assert.deepEqual(
    initialHolidayDraft({
      confirmedAt: "2026-01-01T00:00:00Z",
      entries: [],
      proposal,
    }),
    {
      entries: [],
      proposalHash: null,
    },
  );
});

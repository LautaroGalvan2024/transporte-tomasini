import type { HolidayEntry, HolidayYear } from "../../holiday-types";

export type HolidayEditing =
  { kind: "new" } | { kind: "existing"; originalDate: string };

export type HolidayDiscardAction =
  { kind: "year"; year: number } | { kind: "reload" } | { kind: "proposal" };

export const sortHolidayEntries = (entries: readonly HolidayEntry[]) =>
  [...entries].sort((a, b) => a.date.localeCompare(b.date));

export const holidayEntriesKey = (entries: readonly HolidayEntry[]) =>
  JSON.stringify(sortHolidayEntries(entries));

export function initialHolidayDraft(value: HolidayYear) {
  const proposal =
    !value.confirmedAt && value.entries.length === 0 ? value.proposal : null;
  return {
    entries: sortHolidayEntries(proposal?.entries ?? value.entries),
    proposalHash: proposal?.hash ?? null,
  };
}

export function hasDuplicateHolidayDate(
  entries: readonly HolidayEntry[],
  date: string,
  originalDate: string | null,
) {
  return entries.some(
    (entry) => entry.date !== originalDate && entry.date === date,
  );
}

// The original date is the calendar identity even when the editor changes it.
export function applyHolidayEntry(
  entries: readonly HolidayEntry[],
  editing: HolidayEditing,
  value: HolidayEntry,
) {
  return sortHolidayEntries(
    editing.kind === "new"
      ? [...entries, value]
      : entries.map((entry) =>
          entry.date === editing.originalDate ? value : entry,
        ),
  );
}

export function toggleHolidayEntry(
  entries: readonly HolidayEntry[],
  originalDate: string,
) {
  return entries.map((entry) =>
    entry.date === originalDate ? { ...entry, enabled: !entry.enabled } : entry,
  );
}

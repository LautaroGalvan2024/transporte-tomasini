import { useCallback, useRef, useState } from "react";
import type { HolidayEntry, HolidayYear } from "../../holiday-types";
import { holidayEntriesKey, initialHolidayDraft } from "./draft";

export function useHolidayDraft(loaded: boolean) {
  const [entries, setEntries] = useState<HolidayEntry[]>([]);
  const [proposalHash, setProposalHash] = useState<string | null>(null);
  const baseline = useRef({
    entries: holidayEntriesKey([]),
    proposalHash: null as string | null,
  });
  const adoptDraft = useCallback((value: HolidayYear) => {
    const draft = initialHolidayDraft(value);
    baseline.current = {
      entries: holidayEntriesKey(draft.entries),
      proposalHash: draft.proposalHash,
    };
    setEntries(draft.entries);
    setProposalHash(draft.proposalHash);
  }, []);
  return {
    entries,
    setEntries,
    proposalHash,
    setProposalHash,
    adoptDraft,
    dirty:
      loaded &&
      (holidayEntriesKey(entries) !== baseline.current.entries ||
        proposalHash !== baseline.current.proposalHash),
  };
}

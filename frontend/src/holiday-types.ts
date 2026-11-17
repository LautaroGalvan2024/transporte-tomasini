export interface HolidayEntry {
  date: string;
  name: string;
  source: "official" | "manual";
  enabled: boolean;
}

export interface HolidayYear {
  year: number;
  version: number;
  revision: number;
  confirmedAt: string | null;
  entries: HolidayEntry[];
  proposal: {
    hash: string;
    checkedAt: string;
    sourceUrl: string;
    entries: HolidayEntry[];
  } | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
}

export interface HolidayCalendarStatus {
  currentYear: number;
  needsConfirmation: boolean;
  years: {
    year: number;
    confirmedAt: string | null;
    hasProposal: boolean;
    lastCheckError: string | null;
  }[];
}

export interface HolidayNavigation {
  year: number;
  request: number;
}

export const HOLIDAY_CALENDAR_CHANGED = "tomasini:holiday-calendar-changed";

export function currentHolidayYear() {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
    }).format(new Date()),
  );
}

export function holidayYearFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const year = Number(params.get("year"));
  return params.get("tab") === "holidays" &&
    Number.isInteger(year) &&
    year >= 1900 &&
    year <= 2199
    ? year
    : null;
}

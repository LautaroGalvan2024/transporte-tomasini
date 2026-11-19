import { useEffect, useState } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { api } from "../../api";
import {
  HOLIDAY_CALENDAR_CHANGED,
  currentHolidayYear,
  selectHolidayBanner,
  type HolidayCalendarStatus,
} from "../../holiday-types";
import { holidayMessageOf as messageOf } from "./messages";

export function HolidayCalendarBanner({
  onReview,
}: {
  onReview: (year: number) => void;
}) {
  const [status, setStatus] = useState<HolidayCalendarStatus | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refreshVisible, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(HOLIDAY_CALENDAR_CHANGED, refresh);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(HOLIDAY_CALENDAR_CHANGED, refresh);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    api<HolidayCalendarStatus>("/holiday-calendar/status", {
      signal: controller.signal,
    })
      .then((value) => {
        if (!current) return;
        setStatus(value);
        setError("");
      })
      .catch((error) => {
        if (current) setError(messageOf(error));
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [revision]);
  const notice = status ? selectHolidayBanner(status) : null;
  const year = notice?.year ?? null;
  if (year === null && !error) return null;
  if (!status && !error) return null;
  return (
    <aside
      className={`holiday-banner ${status?.needsConfirmation ? "is-pending" : ""}`}
      aria-label="Calendario de feriados"
    >
      <CalendarDays size={23} aria-hidden="true" />
      <div className="holiday-banner-copy">
        <strong>
          {notice?.kind === "unconfirmed"
            ? `Falta confirmar los feriados de ${year}`
            : notice?.kind === "proposal"
              ? `Hay novedades en los feriados de ${year}`
              : "No pudimos comprobar el calendario de feriados"}
        </strong>
        <p>
          {notice?.kind === "unconfirmed"
            ? "Los viajes pueden cargarse, pero los pendientes de calendario necesitan esta confirmación para su revisión."
            : notice?.kind === "proposal"
              ? "Revisá la propuesta nacional antes de incorporarla al cálculo de km al 100%."
              : error}
        </p>
        {error && notice && (
          <small role="status">No pudimos actualizar este aviso. {error}</small>
        )}
      </div>
      <button
        className="button secondary"
        onClick={() => onReview(year ?? currentHolidayYear())}
      >
        Revisar feriados <ChevronRight size={17} aria-hidden="true" />
      </button>
    </aside>
  );
}

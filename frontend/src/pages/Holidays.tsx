import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { api, ApiError, send } from "../api";
import {
  EmptyState,
  ErrorState,
  Field,
  Loading,
  Modal,
  formatDate,
} from "../ui";
import {
  HOLIDAY_CALENDAR_CHANGED,
  currentHolidayYear,
  selectHolidayBanner,
  type HolidayCalendarStatus,
  type HolidayEntry,
  type HolidayYear,
} from "../holiday-types";
import "../holiday-calendar.css";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "No pudimos completar la acción.";
const sorted = (entries: HolidayEntry[]) =>
  [...entries].sort((a, b) => a.date.localeCompare(b.date));
const entriesKey = (entries: HolidayEntry[]) => JSON.stringify(sorted(entries));

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

export function HolidaysPanel({
  initialYear,
  onNotify,
  onDirtyChange,
}: {
  initialYear?: number;
  onNotify: (message: string, kind?: "success" | "error") => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [year, setYear] = useState(initialYear ?? currentHolidayYear);
  const [yearInput, setYearInput] = useState(String(year));
  const [data, setData] = useState<HolidayYear | null>(null);
  const [entries, setEntries] = useState<HolidayEntry[]>([]);
  const [proposalHash, setProposalHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [discardAction, setDiscardAction] = useState<{
    year?: number;
    reload?: boolean;
    proposal?: boolean;
  } | null>(null);
  const draftBaseline = useRef({
    entries: entriesKey([]),
    proposalHash: null as string | null,
  });
  const dirty =
    !!data &&
    (entriesKey(entries) !== draftBaseline.current.entries ||
      proposalHash !== draftBaseline.current.proposalHash);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => dirtyCallback.current?.(false), []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  useEffect(() => {
    if (initialYear !== undefined) {
      setYear(initialYear);
      setYearInput(String(initialYear));
    }
  }, [initialYear]);

  const adopt = useCallback((value: HolidayYear) => {
    const initialProposal =
      !value.confirmedAt && value.entries.length === 0 ? value.proposal : null;
    const nextEntries = sorted(initialProposal?.entries ?? value.entries);
    const nextProposalHash = initialProposal?.hash ?? null;
    draftBaseline.current = {
      entries: entriesKey(nextEntries),
      proposalHash: nextProposalHash,
    };
    setData(value);
    setEntries(nextEntries);
    setProposalHash(nextProposalHash);
    setError("");
    setSourceError("");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setLoading(true);
    setData(null);
    setError("");
    setSourceError("");
    setEditing(null);
    setConfirming(false);
    api<HolidayYear>(`/holiday-calendar/${year}`, { signal: controller.signal })
      .then((value) => {
        if (current) adopt(value);
      })
      .catch((error) => {
        if (current) setError(messageOf(error));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [year, loadRevision, adopt]);

  function chooseYear(next: number) {
    if (!Number.isInteger(next) || next < 1900 || next > 9999) {
      setError("Elegí un año de cuatro dígitos, desde 1900.");
      setYearInput(String(year));
      return;
    }
    if (next === year) {
      setYearInput(String(year));
      return;
    }
    if (dirty) {
      setDiscardAction({ year: next });
      return;
    }
    setYear(next);
    setYearInput(String(next));
  }
  function loadProposal() {
    if (!data?.proposal) return;
    setEntries(sorted(data.proposal.entries));
    setProposalHash(data.proposal.hash);
    setError("");
  }
  async function checkSource() {
    if (busy || !data) return;
    setBusy("check");
    setError("");
    setSourceError("");
    try {
      const result = await send<HolidayYear>(
        `/holiday-calendar/${year}/check`,
        "POST",
      );
      adopt(result);
      window.dispatchEvent(new Event(HOLIDAY_CALENDAR_CHANGED));
      if (result.annualSourceStatus === "available")
        onNotify("Fuente anual consultada. Revisá las novedades disponibles.");
    } catch (error) {
      // A failed source check may still update its status and editing version.
      let savedSourceError = false;
      try {
        const latest = await api<HolidayYear>(`/holiday-calendar/${year}`);
        adopt(latest);
        savedSourceError =
          !!latest.lastCheckError ||
          latest.annualSourceStatus === "not_published";
      } catch {
        /* Keep the loaded calendar if its refresh also fails. */
      }
      if (!savedSourceError) setSourceError(messageOf(error));
      window.dispatchEvent(new Event(HOLIDAY_CALENDAR_CHANGED));
    } finally {
      setBusy(null);
    }
  }
  async function save(confirm: boolean) {
    if (!data || busy) return;
    setBusy("save");
    setError("");
    try {
      const result = await send<HolidayYear>(
        `/holiday-calendar/${year}`,
        "PUT",
        {
          version: data.version,
          entries: sorted(entries),
          confirm,
          ...(proposalHash ? { proposalHash } : {}),
        },
      );
      adopt(result);
      setConfirming(false);
      window.dispatchEvent(new Event(HOLIDAY_CALENDAR_CHANGED));
      onNotify(
        confirm
          ? `Calendario de ${year} confirmado.`
          : "Borrador de feriados guardado.",
      );
    } catch (error) {
      setConfirming(false);
      setError(
        error instanceof ApiError && error.status === 409
          ? `${error.message} Tus cambios siguen en pantalla. Recargá el calendario para consultar la última versión.`
          : messageOf(error),
      );
    } finally {
      setBusy(null);
    }
  }

  const enabled = entries.filter((entry) => entry.enabled).length;
  return (
    <section className="holiday-panel" aria-label="Feriados y días especiales">
      <div className="holiday-toolbar">
        <div>
          <h2>Feriados y días especiales</h2>
          <p>
            Días completos al 100% para todos los choferes, con horario de
            Argentina.
          </p>
        </div>
        <form
          className="holiday-year-picker"
          onSubmit={(event) => {
            event.preventDefault();
            chooseYear(Number(yearInput));
          }}
        >
          <button
            type="button"
            className="button ghost icon"
            aria-label="Año anterior"
            disabled={!!busy || year <= 1900}
            onClick={() => chooseYear(year - 1)}
          >
            <ChevronLeft size={19} />
          </button>
          <Field label="Año">
            <input
              aria-label="Año del calendario"
              type="number"
              min="1900"
              max="9999"
              value={yearInput}
              disabled={!!busy}
              onChange={(event) => setYearInput(event.target.value)}
              onBlur={() => chooseYear(Number(yearInput))}
            />
          </Field>
          <button
            type="button"
            className="button ghost icon"
            aria-label="Año siguiente"
            disabled={!!busy || year >= 9999}
            onClick={() => chooseYear(year + 1)}
          >
            <ChevronRight size={19} />
          </button>
        </form>
      </div>
      {loading && <Loading label={`Cargando feriados de ${year}…`} />}
      {!loading && !data && error && (
        <ErrorState
          message={error}
          onRetry={() => setLoadRevision((value) => value + 1)}
        />
      )}
      {!loading && data && (
        <>
          <div
            className={`holiday-year-status ${data.confirmedAt ? "is-confirmed" : "is-pending"}`}
          >
            {data.confirmedAt ? (
              <CheckCircle2 size={22} aria-hidden="true" />
            ) : (
              <CircleAlert size={22} aria-hidden="true" />
            )}
            <div>
              <strong>
                {data.confirmedAt
                  ? `Calendario ${year} confirmado`
                  : `Calendario ${year} sin confirmar`}
              </strong>
              <p>
                {data.confirmedAt
                  ? `Última confirmación: ${formatDate(data.confirmedAt, true)}.`
                  : "Los viajes de este año requieren informar los km al 100% hasta confirmar el calendario."}
              </p>
            </div>
            <span
              className={`badge ${data.confirmedAt ? "success" : "warning"}`}
            >
              {data.confirmedAt ? "Confirmado" : "Pendiente"}
            </span>
          </div>
          <section className="admin-surface holiday-source">
            <div className="holiday-source-heading">
              <div>
                <h3>Calendario nacional</h3>
                <p>
                  {data.lastCheckedAt
                    ? `Última consulta de la fuente anual: ${formatDate(data.lastCheckedAt, true)}.`
                    : data.proposal
                      ? "Ya hay un calendario base disponible para revisar."
                      : "Todavía no se consultó la fuente anual para este año."}
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy || dirty}
                onClick={() => void checkSource()}
              >
                <RefreshCw
                  size={16}
                  className={busy === "check" ? "spin" : ""}
                  aria-hidden="true"
                />
                {busy === "check" ? "Consultando…" : "Consultar fuente anual"}
              </button>
            </div>
            {dirty && (
              <p className="holiday-hint">
                Guardá o descartá los cambios antes de buscar otra
                actualización.
              </p>
            )}
            {data.annualSourceStatus === "not_published" && (
              <p className="holiday-source-notice" role="status">
                La fuente anual de {year} todavía no está publicada.
                {data.proposal?.kind === "statutory"
                  ? " Podés revisar y confirmar el calendario base calculado; los días extraordinarios requieren revisión cuando se anuncien."
                  : data.confirmedAt
                    ? " Tu calendario confirmado se conserva."
                    : " Podés completar y revisar los días del año antes de confirmarlo."}
              </p>
            )}
            {(sourceError ||
              (data.annualSourceStatus !== "not_published" &&
                data.lastCheckError)) && (
              <p className="holiday-source-error" role="status">
                <CircleAlert size={17} aria-hidden="true" />
                {sourceError || data.lastCheckError}
              </p>
            )}
            {data.proposal ? (
              <div className="holiday-proposal">
                <div>
                  <strong>
                    {data.proposal.kind === "statutory"
                      ? "Base nacional calculada"
                      : proposalHash
                        ? "Propuesta nacional cargada para revisar"
                        : "Propuesta nacional pendiente de revisión"}
                  </strong>
                  <p>
                    {proposalHash
                      ? "Revisá las fechas de la lista y confirmá el calendario para aplicarlas."
                      : "La propuesta conserva los días especiales y los ajustes que ya guardaste."}
                  </p>
                  {data.proposal.kind === "statutory" && (
                    <p>
                      Calculada con las reglas nacionales de feriados. Los días
                      turísticos, no laborables y extraordinarios requieren
                      revisión o carga manual.
                    </p>
                  )}
                  {/^https:\/\//.test(data.proposal.sourceUrl) && (
                    <a
                      href={data.proposal.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {data.proposal.kind === "statutory"
                        ? "Ver reglas de feriados"
                        : "Ver fuente anual"}{" "}
                      <ExternalLink size={14} aria-hidden="true" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!busy || !!proposalHash}
                  onClick={() =>
                    dirty
                      ? setDiscardAction({ proposal: true })
                      : loadProposal()
                  }
                >
                  {proposalHash ? (
                    <Check size={17} aria-hidden="true" />
                  ) : (
                    <CalendarDays size={17} aria-hidden="true" />
                  )}
                  {proposalHash
                    ? "Lista cargada para revisar"
                    : data.proposal.kind === "statutory"
                      ? "Revisar calendario base"
                      : "Revisar propuesta"}
                </button>
              </div>
            ) : (
              <p className="holiday-hint">
                {data.confirmedAt
                  ? "No hay una propuesta nueva pendiente."
                  : "Podés completar los días manualmente y confirmar el año después de revisarlos."}
              </p>
            )}
          </section>
          {error && (
            <div className="holiday-save-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  dirty
                    ? setDiscardAction({ reload: true })
                    : setLoadRevision((value) => value + 1)
                }
              >
                Recargar calendario
              </button>
            </div>
          )}
          <section className="admin-surface holiday-dates">
            <div className="holiday-list-heading">
              <div>
                <h3>Días al 100%</h3>
                <p>
                  {enabled}{" "}
                  {enabled === 1 ? "día habilitado" : "días habilitados"} ·{" "}
                  {dirty
                    ? "Cambios sin guardar"
                    : proposalHash
                      ? "Propuesta sin confirmar"
                      : "Lista guardada"}
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setEditing("new")}
              >
                <Plus size={17} aria-hidden="true" />
                Agregar día especial
              </button>
            </div>
            {!entries.length ? (
              <EmptyState
                title="Todavía no hay días cargados"
                description={
                  data.proposal
                    ? "Usá Revisar propuesta para incorporar los feriados nacionales."
                    : "Agregá los días especiales de la empresa o buscá el calendario nacional."
                }
                icon={<CalendarDays size={26} />}
              />
            ) : (
              <div className="holiday-date-list">
                <div
                  className="holiday-row holiday-row-heading"
                  aria-hidden="true"
                >
                  <span>Fecha</span>
                  <span>Motivo y origen</span>
                  <span>Estado</span>
                  <span>Acciones</span>
                </div>
                {entries.map((entry, index) => (
                  <article
                    key={`${entry.date}-${entry.source}`}
                    className={`holiday-row ${!entry.enabled ? "is-disabled" : ""}`}
                  >
                    <div className="holiday-date">
                      <strong>{formatDate(entry.date)}</strong>
                      <small>Día completo</small>
                    </div>
                    <div className="holiday-name">
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.source === "official"
                          ? "Nacional"
                          : "Especial de la empresa"}
                      </small>
                    </div>
                    <span
                      className={`badge ${entry.enabled ? "success" : "neutral"}`}
                    >
                      {entry.enabled ? "Habilitado" : "Desactivado"}
                    </span>
                    <div className="holiday-row-actions">
                      <button
                        type="button"
                        className="button ghost"
                        disabled={!!busy}
                        onClick={() => setEditing(index)}
                        aria-label={`Editar ${entry.name}, ${formatDate(entry.date)}`}
                      >
                        <Pencil size={16} aria-hidden="true" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        className="button ghost"
                        disabled={!!busy}
                        onClick={() =>
                          setEntries((current) =>
                            current.map((value, i) =>
                              i === index
                                ? { ...value, enabled: !value.enabled }
                                : value,
                            ),
                          )
                        }
                        aria-label={`${entry.enabled ? "Desactivar" : "Activar"} ${entry.name}, ${formatDate(entry.date)}`}
                      >
                        {entry.enabled ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="holiday-list-footnote">
              Los sábados desde las 13:00 y los domingos ya se consideran
              automáticamente. Una fecha que coincide se cuenta una sola vez.
            </div>
          </section>
          <div className="holiday-actions">
            <p>
              {dirty
                ? "Tenés cambios sin guardar."
                : proposalHash
                  ? "La propuesta está lista para revisar. Se aplica sólo después de confirmar el calendario."
                  : "Los cambios del calendario se aplican a nuevas cargas y correcciones expresas de viajes."}
            </p>
            <div>
              {dirty && (
                <button
                  type="button"
                  className="button ghost"
                  disabled={!!busy}
                  onClick={() => setDiscardAction({ reload: true })}
                >
                  Descartar cambios
                </button>
              )}
              {!data.confirmedAt && dirty && !proposalHash && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => void save(false)}
                >
                  Guardar borrador
                </button>
              )}
              <button
                type="button"
                className="button primary"
                disabled={!!busy || (data.confirmedAt !== null && !dirty)}
                onClick={() => setConfirming(true)}
              >
                <CheckCircle2 size={18} aria-hidden="true" />
                {busy === "save"
                  ? "Guardando…"
                  : data.confirmedAt
                    ? "Confirmar cambios"
                    : `Confirmar calendario ${year}`}
              </button>
            </div>
          </div>
        </>
      )}
      {editing !== null && (
        <HolidayEditor
          year={year}
          entry={editing === "new" ? null : entries[editing]}
          entries={entries}
          onClose={() => setEditing(null)}
          onSave={(value) => {
            setEntries((current) =>
              sorted(
                editing === "new"
                  ? [...current, value]
                  : current.map((entry, index) =>
                      index === editing ? value : entry,
                    ),
              ),
            );
            setEditing(null);
            setError("");
          }}
        />
      )}
      {confirming && data && (
        <Modal
          title={`Confirmar feriados de ${year}`}
          dismissible={!busy}
          onClose={() => setConfirming(false)}
        >
          <div className="holiday-confirm">
            <p>
              Se aplicarán{" "}
              <strong>
                {enabled} {enabled === 1 ? "día completo" : "días completos"} al
                100%
              </strong>{" "}
              para todos los choferes.
            </p>
            <p>
              {proposalHash
                ? "Esta confirmación incorpora la propuesta nacional revisada y conserva los días especiales de la lista."
                : "Confirmá que revisaste todos los feriados y días especiales del año."}
            </p>
            <p>
              Los kilómetros de los viajes guardados se conservan. Los viajes
              pendientes de calendario deberán resolverse en su revisión.
            </p>
            {enabled === 0 && (
              <p className="holiday-source-error">
                La lista no tiene días habilitados. Los fines de semana seguirán
                aplicándose automáticamente.
              </p>
            )}
            <div className="holiday-modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setConfirming(false)}
              >
                Seguir revisando
              </button>
              <button
                type="button"
                className="button primary"
                disabled={!!busy}
                onClick={() => void save(true)}
              >
                {busy ? "Confirmando…" : "Confirmar calendario"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {discardAction && (
        <Modal
          title="Hay cambios sin guardar"
          onClose={() => {
            setDiscardAction(null);
            setYearInput(String(year));
          }}
        >
          <div className="holiday-confirm">
            <p>
              {discardAction.proposal
                ? "Al cargar la propuesta se reemplazará el borrador de esta pantalla. Los cambios guardados ya están incluidos en la propuesta."
                : "Si continuás, se perderán los cambios que todavía no guardaste en este calendario."}
            </p>
            <div className="holiday-modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setDiscardAction(null);
                  setYearInput(String(year));
                }}
              >
                Seguir editando
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  const action = discardAction;
                  setDiscardAction(null);
                  if (action.year !== undefined) {
                    setYear(action.year);
                    setYearInput(String(action.year));
                  } else if (action.proposal) loadProposal();
                  else setLoadRevision((value) => value + 1);
                }}
              >
                Descartar y continuar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

function HolidayEditor({
  year,
  entry,
  entries,
  onClose,
  onSave,
}: {
  year: number;
  entry: HolidayEntry | null;
  entries: HolidayEntry[];
  onClose: () => void;
  onSave: (entry: HolidayEntry) => void;
}) {
  const [date, setDate] = useState(entry?.date ?? "");
  const [name, setName] = useState(entry?.name ?? "");
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !date.startsWith(`${year}-`) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !name.trim()
    ) {
      setError("Ingresá una fecha del año seleccionado y un motivo.");
      return;
    }
    if (entries.some((value) => value !== entry && value.date === date)) {
      setError(
        "Esta fecha ya está cargada. Editá el día existente para evitar duplicados.",
      );
      return;
    }
    onSave({
      date,
      name: name.trim(),
      enabled,
      source: entry?.source ?? "manual",
    });
  }
  return (
    <Modal
      title={entry ? "Editar día al 100%" : "Agregar día especial"}
      onClose={onClose}
    >
      <form className="admin-form holiday-editor" onSubmit={submit}>
        <p>
          Aplica el día completo, de 00:00 a 00:00 del día siguiente, para todos
          los choferes.
        </p>
        <Field label="Fecha">
          <input
            type="date"
            required
            min={`${year}-01-01`}
            max={`${year}-12-31`}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
        <Field label="Motivo">
          <input
            required
            maxLength={180}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ej. Día del Camionero"
          />
        </Field>
        <label className="holiday-enabled-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>Habilitado para km al 100%</span>
        </label>
        {entry?.source === "official" && (
          <p className="holiday-hint">
            Origen: calendario nacional. Los ajustes guardados se conservarán al
            revisar futuras propuestas.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="holiday-modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="button primary">
            {entry ? "Aplicar al borrador" : "Agregar al borrador"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

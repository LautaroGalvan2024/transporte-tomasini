import {
  addMonths,
  obligationFormDefaults,
  renewalFormDefaults,
  buildObligationPayload,
  buildRenewalPayload,
  obligationErrorStep,
  renewalErrorStep,
} from "./obligation-forms";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  FileCheck2,
  History,
  Pencil,
  Plus,
  Wrench,
} from "lucide-react";
import { send, ApiError } from "../../api";
import type {
  Driver,
  Obligation,
  PageProps,
  Renewal,
  Settings,
  Truck,
  Trailer,
} from "../../types";
import { EmptyState, Field, Modal, StatusBadge, formatKm } from "../../ui";
import {
  dateToday,
  dateTimeInput,
  businessInstant,
  dateLabel,
} from "./formatting";
import {
  useLoad,
  PageHeading,
  usePageSize,
  Pagination,
  usePagination,
  LoadState,
  FormError,
  useFormStatus,
  OwnerLabel,
  DueSummary,
} from "./shared";

function FormSteps({ labels, step }: { labels: string[]; step: number }) {
  return (
    <ol className="admin-form-steps" aria-label="Pasos del formulario">
      {labels.map((label, index) => (
        <li
          key={label}
          className={
            index === step ? "current" : index < step ? "complete" : ""
          }
          aria-current={index === step ? "step" : undefined}
        >
          <span>{index < step ? <Check size={14} /> : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

function StepFooter({
  step,
  finalStep,
  busy,
  onBack,
  onClose,
  label,
}: {
  step: number;
  finalStep: number;
  busy: boolean;
  onBack: () => void;
  onClose: () => void;
  label: string;
}) {
  return (
    <div className="admin-form-footer">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={step ? onBack : onClose}
      >
        {step ? <ChevronLeft size={18} /> : null}
        {step ? "Volver" : "Cancelar"}
      </button>
      <button className="button primary" disabled={busy}>
        {busy ? "Guardando…" : step === finalStep ? label : "Continuar"}
        {!busy &&
          (step === finalStep ? <Check size={18} /> : <ArrowRight size={18} />)}
      </button>
    </div>
  );
}

function ObligationForm({
  obligation,
  trucks,
  trailers,
  drivers,
  defaults,
  onClose,
  onSaved,
}: {
  obligation: Obligation | null;
  trucks: Truck[];
  trailers: Trailer[];
  drivers: Driver[];
  defaults: Settings | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initial] = useState(() => obligationFormDefaults(obligation, defaults, dateTimeInput()));
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [ownerType, setOwnerType] = useState(initial.ownerType);
  const [ownerId, setOwnerId] = useState(initial.ownerId);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [dueKm, setDueKm] = useState(initial.dueKm);
  const [intervalMonths, setIntervalMonths] = useState(initial.intervalMonths);
  const [intervalKm, setIntervalKm] = useState(initial.intervalKm);
  const [warningDays, setWarningDays] = useState(initial.warningDays);
  const [warningKm, setWarningKm] = useState(initial.warningKm);
  const [notes, setNotes] = useState(initial.notes);
  const [active, setActive] = useState(initial.active);
  const [initialRecord, setInitialRecord] = useState(initial.initialRecord);
  const [performedAt, setPerformedAt] = useState(initial.performedAt);
  const [odometer, setOdometer] = useState(initial.odometer);
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    form.begin();
    try {
      await send(
        obligation ? `/obligations/${obligation.id}` : "/obligations",
        obligation ? "PATCH" : "POST",
        buildObligationPayload({
          title, kind, ownerType, ownerId, dueDate, dueKm, intervalMonths, intervalKm,
          warningDays, warningKm, notes, active, initialRecord, performedAt, odometer,
        }, obligation),
      );
      onSaved();
    } catch (error) {
      form.fail(error);
      if (error instanceof ApiError)
        setStep(obligationErrorStep(error.fields, step));
    }
  }
  const ownerName =
    ownerType === "truck"
      ? trucks.find((item) => item.id === ownerId)?.plate
      : ownerType === "trailer"
        ? trailers.find((item) => item.id === ownerId)?.plate
        : drivers.find((item) => item.id === ownerId)?.name;
  return (
    <Modal
      title={obligation ? "Editar vencimiento" : "Agregar vencimiento"}
      wide
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form admin-step-form" onSubmit={submit}>
        <FormSteps
          labels={["Datos", "Programación", "Confirmación"]}
          step={step}
        />
        <FormError message={form.message} />
        <div className="admin-step-content" key={step}>
          {step === 0 && (
            <>
              {!obligation && (
                <div
                  className="admin-type-picker"
                  role="group"
                  aria-label="Tipo de vencimiento"
                >
                  <button
                    type="button"
                    className={kind === "SERVICE" ? "selected" : ""}
                    aria-pressed={kind === "SERVICE"}
                    onClick={() => {
                      setKind("SERVICE");
                      if (ownerType === "driver") {
                        setOwnerType("truck");
                        setOwnerId("");
                      }
                    }}
                  >
                    <Wrench size={19} />
                    Servicio{kind === "SERVICE" && <Check size={16} />}
                  </button>
                  <button
                    type="button"
                    className={kind === "DOCUMENT" ? "selected" : ""}
                    aria-pressed={kind === "DOCUMENT"}
                    onClick={() => setKind("DOCUMENT")}
                  >
                    <FileCheck2 size={19} />
                    Documento{kind === "DOCUMENT" && <Check size={16} />}
                  </button>
                </div>
              )}
              <Field label="Nombre" error={form.fields.title}>
                <input
                  required
                  maxLength={120}
                  placeholder={
                    kind === "SERVICE"
                      ? "Ej. Cambio de aceite y filtros"
                      : "Ej. Seguro del camión"
                  }
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <div className="grid2">
                <Field label="Corresponde a">
                  <select
                    value={ownerType}
                    disabled={!!obligation}
                    onChange={(event) => {
                      setOwnerType(
                        event.target.value as "truck" | "trailer" | "driver",
                      );
                      setOwnerId("");
                      setDueKm("");
                      setIntervalKm("");
                      setOdometer("");
                    }}
                  >
                    <option value="truck">Un camión</option>
                    <option value="trailer">Un acoplado</option>
                    {kind === "DOCUMENT" && (
                      <option value="driver">Un chofer</option>
                    )}
                  </select>
                </Field>
                <Field
                  label={
                    ownerType === "truck"
                      ? "Camión"
                      : ownerType === "trailer"
                        ? "Acoplado"
                        : "Chofer"
                  }
                  error={
                    form.fields.truckId ||
                    form.fields.trailerId ||
                    form.fields.driverId
                  }
                >
                  <select
                    required
                    disabled={!!obligation}
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                  >
                    <option value="">Seleccionar…</option>
                    {ownerType !== "driver"
                      ? (ownerType === "truck" ? trucks : trailers)
                          .filter((item) => item.active || item.id === ownerId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.plate} · {item.label}
                            </option>
                          ))
                      : drivers
                          .filter((item) => item.active || item.id === ownerId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                  </select>
                </Field>
              </div>
              <Field label="Observaciones (opcional)" error={form.fields.notes}>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </>
          )}
          {step === 1 && (
            <>
              <div className="grid2">
                <Field
                  label="Fecha límite (opcional)"
                  error={form.fields.dueDate}
                >
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                  />
                </Field>
                {ownerType === "truck" && (
                  <Field
                    label="Odómetro límite (opcional)"
                    error={form.fields.dueKm}
                  >
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      placeholder="Ej. 450000"
                      value={dueKm}
                      onChange={(event) => setDueKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              <p className="admin-field-note">
                {dueDate || (ownerType === "truck" && dueKm)
                  ? ownerType === "truck"
                    ? "Se avisa al alcanzar cualquiera de los límites. El odómetro es la lectura total, no los kilómetros restantes."
                    : "Se avisará según la fecha límite y los días de anticipación que definas."
                  : "Sin un límite, quedará pendiente de configurar."}
              </p>
              <div className="grid2">
                <Field
                  label="Repetir cada… meses (opcional)"
                  error={form.fields.intervalMonths}
                >
                  <input
                    type="number"
                    min="1"
                    max="120"
                    step="1"
                    inputMode="numeric"
                    value={intervalMonths}
                    onChange={(event) => setIntervalMonths(event.target.value)}
                  />
                </Field>
                {ownerType === "truck" && (
                  <Field
                    label="Repetir cada… km (opcional)"
                    error={form.fields.intervalKm}
                  >
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={intervalKm}
                      onChange={(event) => setIntervalKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              <div className="grid2">
                <Field
                  label="Avisar con… días de anticipación"
                  error={form.fields.warningDays}
                >
                  <input
                    required
                    type="number"
                    min="0"
                    max="365"
                    step="1"
                    inputMode="numeric"
                    value={warningDays}
                    onChange={(event) => setWarningDays(event.target.value)}
                  />
                </Field>
                {ownerType === "truck" && (
                  <Field
                    label="Avisar con… km de anticipación"
                    error={form.fields.warningKm}
                  >
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={warningKm}
                      onChange={(event) => setWarningKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <dl className="admin-confirmation">
                <div>
                  <dt>{ownerName}</dt>
                  <dd>{title}</dd>
                </div>
                <div>
                  <dt>Próximo vencimiento</dt>
                  <dd>
                    {[
                      dueDate ? dateLabel(dueDate) : null,
                      ownerType === "truck" && dueKm
                        ? `${formatKm(Number(dueKm))} km`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Pendiente de configurar"}
                  </dd>
                </div>
              </dl>
              {!obligation && kind === "SERVICE" && (
                <>
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={initialRecord}
                      onChange={(event) =>
                        setInitialRecord(event.target.checked)
                      }
                    />
                    <span>Registrar también el último servicio</span>
                  </label>
                  {initialRecord && (
                    <>
                      <div className="grid2">
                        <Field
                          label="Fecha y hora del servicio"
                          error={form.fields["initialRecord.performedAt"]}
                        >
                          <input
                            required
                            type="datetime-local"
                            value={performedAt}
                            max={dateTimeInput()}
                            onChange={(event) =>
                              setPerformedAt(event.target.value)
                            }
                          />
                        </Field>
                        {ownerType === "truck" && (
                          <Field
                            label="Odómetro de ese servicio"
                            error={form.fields["initialRecord.odometer"]}
                          >
                            <input
                              required
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              value={odometer}
                              onChange={(event) =>
                                setOdometer(event.target.value)
                              }
                            />
                          </Field>
                        )}
                      </div>
                      {(intervalMonths || intervalKm) && (
                        <button
                          className="button secondary"
                          type="button"
                          disabled={!performedAt || (!!intervalKm && !odometer)}
                          onClick={() => {
                            if (intervalMonths)
                              setDueDate(
                                addMonths(performedAt, Number(intervalMonths)),
                              );
                            if (intervalKm && odometer)
                              setDueKm(
                                String(Number(odometer) + Number(intervalKm)),
                              );
                          }}
                        >
                          Calcular próximo límite
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {obligation && (
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(event) => setActive(event.target.checked)}
                  />
                  <span>
                    <strong>Seguimiento activo</strong>
                    <small>
                      Al desactivarlo se detienen los avisos. El historial se
                      conserva.
                    </small>
                  </span>
                </label>
              )}
            </>
          )}
        </div>
        <StepFooter
          step={step}
          finalStep={2}
          busy={form.busy}
          onBack={() => setStep(step - 1)}
          onClose={onClose}
          label={obligation ? "Guardar cambios" : "Agregar vencimiento"}
        />
      </form>
    </Modal>
  );
}

function RenewalForm({
  obligation,
  onClose,
  onSaved,
}: {
  obligation: Obligation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initial] = useState(() => renewalFormDefaults(obligation, dateTimeInput(), dateToday()));
  const [step, setStep] = useState(0);
  const [performedAt, setPerformedAt] = useState(initial.performedAt);
  const [odometer, setOdometer] = useState(initial.odometer);
  const [nextDueDate, setNextDueDate] = useState(initial.nextDueDate);
  const [nextDueKm, setNextDueKm] = useState(initial.nextDueKm);
  const [notes, setNotes] = useState(initial.notes);
  const form = useFormStatus();
  const service = obligation.kind === "SERVICE";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    if (step === 0) {
      setStep(1);
      return;
    }
    form.begin();
    try {
      await send(`/obligations/${obligation.id}/renewals`, "POST",
        buildRenewalPayload({ performedAt, odometer, nextDueDate, nextDueKm, notes }, obligation),
      );
      onSaved();
    } catch (error) {
      form.fail(error);
      if (error instanceof ApiError)
        setStep(renewalErrorStep(error.fields, step));
    }
  }
  return (
    <Modal
      title={service ? "Registrar servicio" : "Renovar documento"}
      wide
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form admin-step-form" onSubmit={submit}>
        <FormSteps labels={["Registro", "Próximo vencimiento"]} step={step} />
        <div className="admin-renewal-context">
          <strong>{obligation.title}</strong>
          <OwnerLabel obligation={obligation} />
        </div>
        <FormError message={form.message} />
        <div className="admin-step-content" key={step}>
          {step === 0 ? (
            <>
              <div className="grid2">
                <Field
                  label={
                    service
                      ? "Fecha y hora del servicio"
                      : "Fecha y hora de renovación"
                  }
                  error={form.fields.performedAt}
                >
                  <input
                    required
                    type="datetime-local"
                    max={dateTimeInput()}
                    value={performedAt}
                    onChange={(event) => setPerformedAt(event.target.value)}
                  />
                </Field>
                {service && obligation.truckId && (
                  <Field
                    label="Odómetro del servicio"
                    error={form.fields.odometer}
                    hint={
                      obligation.truck?.odometer != null
                        ? `Última lectura: ${formatKm(obligation.truck.odometer)} km (${dateLabel(obligation.truck.odometerAt)}).`
                        : "Kilometraje del camión sin informar."
                    }
                  >
                    <input
                      required
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={odometer}
                      onChange={(event) => setOdometer(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              <Field label="Observaciones (opcional)" error={form.fields.notes}>
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="grid2">
                <Field
                  label="Próxima fecha (opcional)"
                  error={form.fields.nextDueDate}
                >
                  <input
                    type="date"
                    min={performedAt.slice(0, 10)}
                    value={nextDueDate}
                    onChange={(event) => setNextDueDate(event.target.value)}
                  />
                </Field>
                {obligation.truckId && (
                  <Field
                    label="Próximo odómetro (opcional)"
                    error={form.fields.nextDueKm}
                  >
                    <input
                      type="number"
                      inputMode="numeric"
                      min={odometer ? Number(odometer) + 1 : 0}
                      step="1"
                      value={nextDueKm}
                      onChange={(event) => setNextDueKm(event.target.value)}
                    />
                  </Field>
                )}
              </div>
              {(obligation.intervalMonths || obligation.intervalKm) && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    if (obligation.intervalMonths)
                      setNextDueDate(
                        addMonths(performedAt, obligation.intervalMonths),
                      );
                    if (obligation.intervalKm && odometer)
                      setNextDueKm(
                        String(Number(odometer) + obligation.intervalKm),
                      );
                  }}
                >
                  Sugerir según la frecuencia
                </button>
              )}
              <p className="admin-field-note">
                {nextDueDate || nextDueKm
                  ? "Confirmá estos límites. El registro anterior se conserva en el historial."
                  : "Sin un próximo límite, quedará pendiente de configurar."}
              </p>
              <dl className="admin-confirmation">
                <div>
                  <dt>
                    {service ? "Servicio realizado" : "Documento renovado"}
                  </dt>
                  <dd>
                    {dateLabel(businessInstant(performedAt))}
                    {service && odometer
                      ? ` · ${formatKm(Number(odometer))} km`
                      : ""}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
        <StepFooter
          step={step}
          finalStep={1}
          busy={form.busy}
          onBack={() => setStep(0)}
          onClose={onClose}
          label={service ? "Confirmar servicio" : "Confirmar renovación"}
        />
      </form>
    </Modal>
  );
}

function HistoryModal({
  obligation,
  onClose,
}: {
  obligation: Obligation;
  onClose: () => void;
}) {
  const history = useLoad<{ items: Renewal[] }>(
    `/obligations/${obligation.id}/renewals`,
  );
  const pageSize = 3;
  const paged = usePagination(history.data?.items || [], pageSize);
  return (
    <Modal title="Historial de renovaciones" onClose={onClose}>
      <div className="admin-history-body">
        <div className="admin-history-title">
          <strong>{obligation.title}</strong>
          <OwnerLabel obligation={obligation} />
        </div>
        <LoadState
          loading={history.loading}
          error={history.error}
          retry={history.reload}
        />
        {history.data?.items.length ? (
          <ol className="admin-timeline">
            {paged.items.map((item) => (
              <li key={item.id}>
                <span className="admin-timeline-dot">
                  <Check size={13} />
                </span>
                <div>
                  <strong>{dateLabel(item.performedAt)}</strong>
                  {item.odometer !== null && (
                    <span className="admin-history-km">
                      {formatKm(item.odometer)} km
                    </span>
                  )}
                  {item.notes && <p>{item.notes}</p>}
                  <div className="admin-history-next">
                    <small>Próximo límite registrado</small>
                    <span>
                      {[
                        item.nextDueDate ? dateLabel(item.nextDueDate) : null,
                        item.nextDueKm !== null
                          ? `${formatKm(item.nextDueKm)} km`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Sin definir"}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          !history.loading &&
          !history.error && (
            <EmptyState
              title="Todavía no hay renovaciones"
              description="Los servicios y las renovaciones que registres se guardarán acá."
            />
          )
        )}
        {history.data && (
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={history.data.items.length}
            onPage={paged.setPage}
          />
        )}
        <div className="admin-form-footer">
          <button className="button secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ObligationsPage({ onNotify }: PageProps) {
  const state = useLoad<{ items: Obligation[] }>("/obligations");
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const trailers = useLoad<{ items: Trailer[] }>("/trailers");
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const settings = useLoad<Settings>("/settings");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Obligation | "new" | null>(null);
  const [renewing, setRenewing] = useState<Obligation | null>(null);
  const [history, setHistory] = useState<Obligation | null>(null);
  const active =
    state.data?.items.filter((item) => item.active && item.ownerActive) || [];
  const counts = {
    all: active.length,
    attention: active.filter(
      (item) =>
        item.status === "OVERDUE" ||
        item.status === "UPCOMING" ||
        item.status === "UNCONFIGURED",
    ).length,
    service: active.filter((item) => item.kind === "SERVICE").length,
    document: active.filter((item) => item.kind === "DOCUMENT").length,
  };
  const filtered = (state.data?.items || [])
    .filter(
      (item) =>
        (showInactive || (item.active && item.ownerActive)) &&
        (filter === "all" ||
          (filter === "attention" &&
            item.active &&
            item.ownerActive &&
            item.status !== "OK") ||
          (filter === "service" && item.kind === "SERVICE") ||
          (filter === "document" && item.kind === "DOCUMENT")) &&
        `${item.title} ${item.truck?.plate || ""} ${item.trailer?.plate || ""} ${item.driver?.name || ""}`
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .includes(
            search
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase(),
          ),
    )
    .sort(
      (a, b) =>
        ({ OVERDUE: 0, UPCOMING: 1, UNCONFIGURED: 2, OK: 3 })[a.status] -
        { OVERDUE: 0, UPCOMING: 1, UNCONFIGURED: 2, OK: 3 }[b.status],
    );
  const reloadAll = () => {
    state.reload();
    trucks.reload();
    trailers.reload();
    drivers.reload();
    settings.reload();
  };
  const pageSize = usePageSize(425, 84);
  const paged = usePagination(
    filtered,
    pageSize,
    `${filter}-${search}-${showInactive}`,
  );
  return (
    <div className="admin-page">
      <PageHeading
        title="Vencimientos"
        action={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={19} />
            Agregar vencimiento
          </button>
        }
      />
      <div className="admin-tabs" aria-label="Filtrar vencimientos">
        {(
          [
            ["all", "Todos"],
            ["attention", "Pendientes"],
            ["service", "Servicios"],
            ["document", "Documentos"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
            <span>{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="admin-obligation-search">
        <Field label="Buscar por nombre, patente o chofer">
          <input
            type="search"
            placeholder="Buscar vencimiento…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => setShowInactive(event.target.checked)}
          />
          <span>Incluir inactivos</span>
        </label>
      </div>
      <LoadState
        loading={state.loading && !state.data}
        error={
          state.error ||
          trucks.error ||
          trailers.error ||
          drivers.error ||
          settings.error
        }
        retry={reloadAll}
      />
      {state.data && !state.error && (
        <section className="admin-surface admin-records admin-obligation-records">
          <div className="admin-list-header admin-obligation-row">
            <span>Servicio o documento</span>
            <span>Próximo límite</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {paged.items.map((item) => (
            <article
              key={item.id}
              className={`admin-record-row admin-obligation-row ${!item.active || !item.ownerActive ? "is-inactive" : ""}`}
            >
              <div className="admin-row-identity">
                <span
                  className={`admin-item-symbol ${item.status.toLowerCase()}`}
                >
                  {item.kind === "SERVICE" ? (
                    <Wrench size={21} />
                  ) : (
                    <FileCheck2 size={21} />
                  )}
                </span>
                <div>
                  <h2>{item.title}</h2>
                  <OwnerLabel obligation={item} />
                </div>
              </div>
              <div className="admin-obligation-limit">
                <DueSummary obligation={item} />
                <small>
                  {!item.ownerActive
                    ? "Conservado en el historial"
                    : item.status === "UNCONFIGURED"
                      ? item.odometerMissing
                        ? "Falta informar kilometraje"
                        : "Pendiente de configurar"
                      : [
                          item.daysRemaining !== null
                            ? item.daysRemaining < 0
                              ? `Hace ${Math.abs(item.daysRemaining)} días`
                              : item.daysRemaining === 0
                                ? "Vence hoy"
                                : `En ${item.daysRemaining} días`
                            : null,
                          item.kmRemaining !== null
                            ? item.kmRemaining <= 0
                              ? `${formatKm(Math.abs(item.kmRemaining))} km sobre el límite`
                              : `Faltan ${formatKm(item.kmRemaining)} km`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                </small>
              </div>
              <div className="admin-row-status">
                {item.ownerActive ? (
                  <StatusBadge status={item.status} />
                ) : (
                  <span className="badge neutral">Inactivo</span>
                )}
                {!item.ownerActive ? (
                  <small>
                    {item.truckId
                      ? "Camión dado de baja"
                      : item.trailerId
                        ? "Acoplado dado de baja"
                        : "Chofer inactivo"}
                  </small>
                ) : (
                  !item.active && <small>Inactivo</small>
                )}
              </div>
              <div className="admin-row-actions">
                <button
                  className="button ghost admin-icon-button"
                  aria-label={`Historial de ${item.title}`}
                  title="Historial"
                  onClick={() => setHistory(item)}
                >
                  <History size={19} />
                </button>
                {item.ownerActive && (
                  <button
                    className="button ghost admin-icon-button"
                    aria-label={`Editar ${item.title}`}
                    title="Editar"
                    onClick={() => setEditing(item)}
                  >
                    <Pencil size={18} />
                  </button>
                )}
                {item.active && item.ownerActive && (
                  <button
                    className="button secondary"
                    onClick={() => setRenewing(item)}
                  >
                    {item.kind === "SERVICE" ? "Registrar servicio" : "Renovar"}
                  </button>
                )}
              </div>
            </article>
          ))}
          {!filtered.length && (
            <EmptyState
              title={
                state.data.items.length
                  ? "No hay resultados"
                  : "Todavía no hay vencimientos"
              }
              description={
                state.data.items.length
                  ? "Cambiá los filtros o el texto de búsqueda."
                  : "Agregá un servicio o documento para comenzar."
              }
            />
          )}
          <Pagination
            page={paged.page}
            pageSize={pageSize}
            total={filtered.length}
            onPage={paged.setPage}
          />
        </section>
      )}
      {editing && (
        <ObligationForm
          obligation={editing === "new" ? null : editing}
          trucks={trucks.data?.items || []}
          trailers={trailers.data?.items || []}
          drivers={drivers.data?.items || []}
          defaults={settings.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
            onNotify(
              editing === "new"
                ? "Vencimiento agregado"
                : "Vencimiento actualizado",
            );
          }}
        />
      )}
      {renewing && (
        <RenewalForm
          obligation={renewing}
          onClose={() => setRenewing(null)}
          onSaved={() => {
            setRenewing(null);
            reloadAll();
            onNotify(
              "Registro guardado. El próximo vencimiento ya está actualizado.",
            );
          }}
        />
      )}
      {history && (
        <HistoryModal obligation={history} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

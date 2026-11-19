import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Mail,
  RefreshCw,
} from "lucide-react";
import { send } from "../../api";
import type { Notification, PageProps, Settings } from "../../types";
import { EmptyState, Field, Modal, formatDate } from "../../ui";
import { HolidaysPanel } from "../../pages/Holidays";
import {
  holidayYearFromLocation,
  type HolidayNavigation,
} from "../../holiday-types";
import { dateLabel, statusText } from "./formatting";
import {
  useLoad,
  PageHeading,
  usePageSize,
  Pagination,
  usePagination,
  LoadState,
  FormError,
  useFormStatus,
} from "./shared";

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => void;
}) {
  const [recipientEmail, setRecipientEmail] = useState(
    settings.recipientEmail || "",
  );
  const [warningDays, setWarningDays] = useState(String(settings.warningDays));
  const [warningKm, setWarningKm] = useState(String(settings.warningKm));
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send("/settings", "PATCH", {
        recipientEmail: recipientEmail.trim() || null,
        warningDays: Number(warningDays),
        warningKm: Number(warningKm),
      });
      form.setBusy(false);
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <form
      className="admin-surface admin-settings-form admin-form"
      onSubmit={submit}
    >
      <FormError message={form.message} />
      <section className="admin-setting-section">
        <div>
          <h2>Correo de avisos</h2>
          <p>A las 08:00 de Argentina, cuando haya pendientes.</p>
        </div>
        <div className="admin-setting-fields">
          <Field label="Destinatario" error={form.fields.recipientEmail}>
            <input
              type="email"
              autoComplete="email"
              placeholder="nombre@correo.com"
              value={recipientEmail}
              maxLength={254}
              onChange={(event) => setRecipientEmail(event.target.value)}
            />
          </Field>
          <div
            className={`admin-mail-status ${settings.smtpConfigured ? "configured" : ""}`}
          >
            {settings.smtpConfigured ? (
              <CheckCircle2 size={18} />
            ) : (
              <CircleAlert size={18} />
            )}
            <span>
              {settings.smtpConfigured
                ? "Envío configurado"
                : "Falta configurar la cuenta de envío"}
            </span>
          </div>
        </div>
      </section>
      <section className="admin-setting-section">
        <div>
          <h2>Anticipación de avisos</h2>
          <p>Valores iniciales para nuevos vencimientos.</p>
        </div>
        <div className="admin-setting-fields grid2">
          <Field label="Días antes" error={form.fields.warningDays}>
            <input
              required
              type="number"
              min="0"
              max="365"
              inputMode="numeric"
              value={warningDays}
              onChange={(event) => setWarningDays(event.target.value)}
            />
          </Field>
          <Field label="Kilómetros antes" error={form.fields.warningKm}>
            <input
              required
              type="number"
              min="0"
              inputMode="numeric"
              value={warningKm}
              onChange={(event) => setWarningKm(event.target.value)}
            />
          </Field>
        </div>
      </section>
      <div className="admin-form-footer">
        <button className="button primary" disabled={form.busy}>
          {form.busy ? "Guardando…" : "Guardar preferencias"}
          {!form.busy && <Check size={18} />}
        </button>
      </div>
    </form>
  );
}

export function SettingsPage({
  onNotify,
  holidayNavigation,
  onDirtyChange,
}: PageProps & {
  holidayNavigation?: HolidayNavigation | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const settings = useLoad<Settings>("/settings");
  const notifications = useLoad<{ items: Notification[] }>("/notifications");
  const [tab, setTab] = useState(
    holidayNavigation || holidayYearFromLocation() !== null
      ? "holidays"
      : "settings",
  );
  const [holidayYear, setHolidayYear] = useState<number | undefined>(
    holidayNavigation?.year ?? holidayYearFromLocation() ?? undefined,
  );
  const [holidayDirty, setHolidayDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const handleHolidayDirty = useCallback(
    (dirty: boolean) => {
      setHolidayDirty(dirty);
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );
  useEffect(() => {
    if (holidayNavigation) {
      setHolidayYear(holidayNavigation.year);
      setTab("holidays");
    }
  }, [holidayNavigation]);
  function chooseTab(next: string) {
    if (next === tab) return;
    if (holidayDirty) setPendingTab(next);
    else setTab(next);
  }
  const pageSize = usePageSize(430, 100);
  const paged = usePagination(notifications.data?.items || [], pageSize);
  return (
    <div className="admin-page">
      <PageHeading title="Configuración" />
      <div
        className="admin-tabs holiday-settings-tabs"
        aria-label="Configuración e historial"
      >
        <button
          className={tab === "settings" ? "active" : ""}
          aria-pressed={tab === "settings"}
          onClick={() => chooseTab("settings")}
        >
          Avisos
        </button>
        <button
          className={tab === "holidays" ? "active" : ""}
          aria-pressed={tab === "holidays"}
          onClick={() => chooseTab("holidays")}
        >
          Feriados
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          aria-pressed={tab === "history"}
          onClick={() => chooseTab("history")}
        >
          Historial de correos
        </button>
      </div>
      {tab === "settings" ? (
        <>
          <LoadState
            loading={settings.loading && !settings.data}
            error={settings.error}
            retry={settings.reload}
          />
          {settings.data && !settings.error && (
            <SettingsForm
              key={`${settings.data.recipientEmail}-${settings.data.warningDays}-${settings.data.warningKm}`}
              settings={settings.data}
              onSaved={() => {
                settings.reload();
                onNotify("Preferencias guardadas");
              }}
            />
          )}
        </>
      ) : tab === "holidays" ? (
        <HolidaysPanel
          initialYear={holidayYear}
          onNotify={onNotify}
          onDirtyChange={handleHolidayDirty}
        />
      ) : (
        <>
          <LoadState
            loading={notifications.loading && !notifications.data}
            error={notifications.error}
            retry={notifications.reload}
          />
          {notifications.data && !notifications.error && (
            <section className="admin-surface admin-records">
              <div className="admin-section-toolbar">
                <span className="admin-result-count">
                  {notifications.data.items.length} envíos
                </span>
                <button className="button ghost" onClick={notifications.reload}>
                  <RefreshCw size={17} />
                  Actualizar
                </button>
              </div>
              <div className="admin-notification-list">
                {paged.items.map((item) => (
                  <article key={item.id}>
                    <div className="admin-notification-date">
                      <strong>{dateLabel(item.date)}</strong>
                      <small>
                        {item.sentAt
                          ? formatDate(item.sentAt, true)
                          : `${item.attempts} ${item.attempts === 1 ? "intento" : "intentos"}`}
                      </small>
                    </div>
                    <div className="admin-notification-detail">
                      <p>{item.recipient}</p>
                      {item.error && (
                        <p className="admin-notification-error">
                          {item.status === "FAILED"
                            ? "Se agotaron los intentos. Revisá la cuenta de correo."
                            : item.status === "SUPERSEDED"
                              ? "Reemplazado por un resumen más reciente."
                              : item.status === "CANCELLED"
                                ? "Los pendientes ya fueron resueltos."
                                : "Pendiente de envío. Revisá la cuenta de correo."}
                        </p>
                      )}
                    </div>
                    <span
                      className={`badge ${item.status === "SENT" ? "success" : item.status === "FAILED" ? "danger" : "neutral"}`}
                    >
                      {statusText(item.status)}
                    </span>
                  </article>
                ))}
              </div>
              {!notifications.data.items.length && (
                <EmptyState
                  title="Todavía no hay envíos"
                  description="Los avisos enviados y fallidos aparecerán acá."
                  icon={<Mail size={26} />}
                />
              )}
              <Pagination
                page={paged.page}
                pageSize={pageSize}
                total={notifications.data.items.length}
                onPage={paged.setPage}
              />
            </section>
          )}
        </>
      )}
      {pendingTab && (
        <Modal
          title="Hay cambios sin guardar"
          onClose={() => setPendingTab(null)}
        >
          <div className="holiday-confirm">
            <p>
              Si cambiás de sección, se perderán los cambios que todavía no
              guardaste en el calendario.
            </p>
            <div className="holiday-modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => setPendingTab(null)}
              >
                Seguir editando
              </button>
              <button
                type="button"
                className="button danger"
                onClick={() => {
                  setTab(pendingTab);
                  setPendingTab(null);
                  handleHolidayDirty(false);
                }}
              >
                Descartar y continuar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

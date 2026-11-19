import { useState, type FormEvent } from "react";
import {
  Gauge,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Truck as TruckIcon,
  Trash2,
} from "lucide-react";
import { api, send, ApiError } from "../../api";
import type { Driver, PageProps, Truck } from "../../types";
import { EmptyState, Field, Modal, formatDate, formatKm } from "../../ui";
import { TrailersPanel } from "../../pages/Trailers";
import {
  dateTimeInput,
  businessInstant,
  optionalNumber,
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
  FormFooter,
} from "./shared";

function TruckForm({
  truck,
  onClose,
  onSaved,
}: {
  truck: Truck | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plate, setPlate] = useState(truck?.plate || "");
  const [label, setLabel] = useState(truck?.label || "");
  const [initial, setInitial] = useState("");
  const [at, setAt] = useState(dateTimeInput());
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(
        truck ? `/trucks/${truck.id}` : "/trucks",
        truck ? "PATCH" : "POST",
        truck
          ? { plate: plate.trim().toUpperCase(), label: label.trim() }
          : {
              plate: plate.trim().toUpperCase(),
              label: label.trim(),
              initialOdometer: optionalNumber(initial),
              initialOdometerAt:
                initial.trim() === "" ? null : businessInstant(at),
            },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={truck ? "Editar camión" : "Agregar camión"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <FormError message={form.message} />
        <div className="grid2">
          <Field label="Patente" error={form.fields.plate}>
            <input
              required
              autoCapitalize="characters"
              maxLength={16}
              placeholder="Ej. AB 123 CD"
              value={plate}
              onChange={(event) => setPlate(event.target.value)}
            />
          </Field>
          <Field label="Camión / modelo" error={form.fields.label}>
            <input
              required
              maxLength={100}
              placeholder="Ej. Mercedes-Benz 1634"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        </div>
        {!truck && (
          <div className="admin-form-block">
            <h3>
              <Gauge size={18} />
              Kilometraje inicial (opcional)
            </h3>
            <div className="grid2">
              <Field
                label="Lectura del odómetro"
                error={form.fields.initialOdometer}
                hint="Si no lo sabés, podés cargarlo después o registrar la primera lectura en un viaje."
              >
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="9999999"
                  step="1"
                  placeholder="Sin informar"
                  value={initial}
                  onChange={(event) => setInitial(event.target.value)}
                />
              </Field>
              <Field
                label="Fecha y hora de la lectura"
                error={form.fields.initialOdometerAt}
              >
                <input
                  required={initial.trim() !== ""}
                  disabled={initial.trim() === ""}
                  type="datetime-local"
                  value={at}
                  max={dateTimeInput()}
                  onChange={(event) => setAt(event.target.value)}
                />
              </Field>
            </div>
          </div>
        )}
        <FormFooter
          busy={form.busy}
          onClose={onClose}
          label={truck ? "Guardar cambios" : "Agregar camión"}
        />
      </form>
    </Modal>
  );
}

function OdometerForm({
  truck,
  onClose,
  onSaved,
}: {
  truck: Truck;
  onClose: () => void;
  onSaved: (updated: Truck) => void;
}) {
  const [reference, setReference] = useState(truck);
  const [odometer, setOdometer] = useState(truck.odometer?.toString() ?? "");
  const [conflict, setConflict] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy || conflict) return;
    form.begin();
    try {
      const updated = await send<Truck>(
        `/trucks/${truck.id}/odometer`,
        "PATCH",
        {
          odometer: Number(odometer),
          expectedOdometer: reference.odometer,
          expectedOdometerAt: reference.odometerAt,
        },
      );
      onSaved(updated);
    } catch (error) {
      setConflict(
        error instanceof ApiError && error.code === "ODOMETER_VERSION_CONFLICT",
      );
      form.fail(error);
    }
  }
  async function refresh() {
    if (form.busy) return;
    form.begin();
    try {
      const result = await api<{ items: Truck[] }>("/trucks");
      const current = result.items.find((item) => item.id === truck.id);
      if (!current)
        throw new Error(
          "No encontramos el camión. Volvé a la flota y actualizá la lista.",
        );
      setReference(current);
      setConflict(false);
      setRefreshed(true);
      form.clear();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={
        reference.odometer === null
          ? "Cargar kilometraje"
          : "Editar kilometraje"
      }
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form admin-odometer-form" onSubmit={submit}>
        <div className="admin-access-person">
          <Gauge size={24} />
          <div>
            <strong>{truck.plate}</strong>
            <span>{truck.label}</span>
          </div>
        </div>
        <div className="admin-odometer-reference">
          <span>
            Odómetro actual{" "}
            <strong>
              {reference.odometer === null
                ? "Sin informar"
                : `${formatKm(reference.odometer)} km`}
            </strong>
          </span>
          {reference.odometerAt && (
            <small>Lectura del {formatDate(reference.odometerAt)}</small>
          )}
        </div>
        <Field
          label="Nuevo odómetro (km)"
          error={form.fields.odometer}
          hint="Ingresá el número que marca el tablero del camión."
        >
          <input
            required
            type="number"
            inputMode="numeric"
            min="0"
            max="9999999"
            step="1"
            value={odometer}
            onChange={(event) => setOdometer(event.target.value)}
          />
        </Field>
        <FormError message={form.message} />
        {conflict && (
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={refresh}
          >
            <RefreshCw size={17} />
            {form.busy ? "Actualizando…" : "Actualizar lectura actual"}
          </button>
        )}
        {refreshed && (
          <p className="admin-form-intro" role="status">
            Lectura actualizada. Conservamos el valor que ingresaste; revisalo
            antes de guardar.
          </p>
        )}
        {!reference.active && (
          <p className="form-error" role="alert">
            Este camión está dado de baja. Reactivalo desde Flota para editar el
            kilometraje.
          </p>
        )}
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="button primary"
            disabled={
              form.busy ||
              conflict ||
              !reference.active ||
              odometer.trim() === "" ||
              Number(odometer) === reference.odometer
            }
          >
            {form.busy ? "Guardando…" : "Guardar kilometraje"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TruckStatusForm({
  truck,
  onClose,
  onSaved,
}: {
  truck: Truck;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useFormStatus();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (form.busy) return;
    form.begin();
    try {
      await send(
        `/trucks/${truck.id}`,
        truck.active ? "DELETE" : "PATCH",
        truck.active ? undefined : { active: true },
      );
      onSaved();
    } catch (error) {
      form.fail(error);
    }
  }
  return (
    <Modal
      title={truck.active ? "Dar de baja camión" : "Reactivar camión"}
      onClose={() => {
        if (!form.busy) onClose();
      }}
    >
      <form className="admin-form" onSubmit={submit}>
        <div className="admin-access-person">
          <TruckIcon size={24} />
          <div>
            <strong>{truck.plate}</strong>
            <span>{truck.label}</span>
          </div>
        </div>
        <p className="admin-form-intro">
          {truck.active
            ? "Dejará de estar disponible para nuevos viajes y se quitará de sus choferes y acoplado habituales. Sus viajes y servicios seguirán guardados. Podés reactivarlo después."
            : "Volverá a estar disponible para viajes. Podés asignarle un chofer desde Equipo."}
        </p>
        <FormError message={form.message} />
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={form.busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className={`button ${truck.active ? "danger" : "primary"}`}
            disabled={form.busy}
          >
            {form.busy
              ? "Guardando…"
              : truck.active
                ? "Dar de baja"
                : "Reactivar camión"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function FleetPage({ onNotify }: PageProps) {
  const [tab, setTab] = useState<"trucks" | "trailers">("trucks");
  const [addingTrailer, setAddingTrailer] = useState(false);
  const trucks = useLoad<{ items: Truck[] }>("/trucks");
  const drivers = useLoad<{ items: Driver[] }>("/drivers");
  const [editing, setEditing] = useState<Truck | "new" | null>(null);
  const [odometerTruck, setOdometerTruck] = useState<Truck | null>(null);
  const [statusTruck, setStatusTruck] = useState<Truck | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const items =
    trucks.data?.items.filter((truck) => showInactive || truck.active) || [];
  const pageSize = usePageSize(430, 86);
  const paged = usePagination(items, pageSize, String(showInactive));
  return (
    <div className="admin-page">
      <PageHeading
        title="Flota"
        action={
          <button
            className="button primary"
            onClick={() =>
              tab === "trucks" ? setEditing("new") : setAddingTrailer(true)
            }
          >
            <Plus size={19} />
            {tab === "trucks" ? "Agregar camión" : "Agregar acoplado"}
          </button>
        }
      />
      <div className="admin-tabs" aria-label="Tipo de unidad">
        <button
          className={tab === "trucks" ? "active" : ""}
          aria-pressed={tab === "trucks"}
          onClick={() => setTab("trucks")}
        >
          Camiones
        </button>
        <button
          className={tab === "trailers" ? "active" : ""}
          aria-pressed={tab === "trailers"}
          onClick={() => setTab("trailers")}
        >
          Acoplados
        </button>
      </div>
      {tab === "trailers" ? (
        <TrailersPanel
          adding={addingTrailer}
          onCloseAdd={() => setAddingTrailer(false)}
          onNotify={onNotify}
        />
      ) : (
        <>
          <div className="admin-toolbar">
            <span className="admin-result-count">
              {items.length} {items.length === 1 ? "camión" : "camiones"}
            </span>
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
            loading={trucks.loading && !trucks.data}
            error={trucks.error || drivers.error}
            retry={() => {
              trucks.reload();
              drivers.reload();
            }}
          />
          {trucks.data && !trucks.error && (
            <section className="admin-surface admin-records">
              <div className="admin-list-header admin-fleet-row">
                <span>Camión</span>
                <span>Chofer habitual</span>
                <span>Odómetro</span>
                <span>Estado</span>
                <span>Acciones</span>
              </div>
              {paged.items.map((truck) => {
                const assigned =
                  drivers.data?.items.filter(
                    (driver) =>
                      driver.active && driver.assignedTruckId === truck.id,
                  ) || [];
                return (
                  <article
                    className="admin-record-row admin-fleet-row"
                    key={truck.id}
                  >
                    <div className="admin-row-identity">
                      <span className="admin-item-symbol">
                        <TruckIcon size={24} />
                      </span>
                      <div>
                        <h2>{truck.plate}</h2>
                        <p>{truck.label}</p>
                      </div>
                    </div>
                    <div className="admin-row-secondary">
                      <small className="admin-mobile-label">
                        Chofer habitual
                      </small>
                      {assigned.map((driver) => driver.name).join(", ") ||
                        "Sin asignar"}
                    </div>
                    <div className="admin-row-value">
                      <strong>
                        {truck.odometer === null
                          ? "Sin informar"
                          : `${formatKm(truck.odometer)} km`}
                      </strong>
                      {truck.odometerAt && (
                        <small>{dateLabel(truck.odometerAt)}</small>
                      )}
                    </div>
                    <span
                      className={`badge ${truck.active ? "success" : "neutral"}`}
                    >
                      {truck.active ? "Activo" : "Inactivo"}
                    </span>
                    <div className="admin-row-actions admin-fleet-actions">
                      <button
                        className="button ghost"
                        aria-label={`Editar camión ${truck.plate}`}
                        onClick={() => setEditing(truck)}
                      >
                        <Pencil size={17} />
                        <span>Editar</span>
                      </button>
                      {truck.active && (
                        <button
                          className={`button ghost ${truck.odometer === null ? "admin-load-odometer" : "admin-icon-button"}`}
                          title={
                            truck.odometer === null
                              ? "Cargar kilometraje"
                              : "Editar kilometraje"
                          }
                          aria-label={`${truck.odometer === null ? "Cargar" : "Editar"} kilometraje de ${truck.plate}`}
                          onClick={() => setOdometerTruck(truck)}
                        >
                          <Gauge size={20} />
                          {truck.odometer === null && <span>Cargar km</span>}
                        </button>
                      )}
                      <button
                        className={`button ghost admin-icon-button ${truck.active ? "admin-destructive-action" : ""}`}
                        title={truck.active ? "Dar de baja" : "Reactivar"}
                        aria-label={`${truck.active ? "Dar de baja" : "Reactivar"} camión ${truck.plate}`}
                        onClick={() => setStatusTruck(truck)}
                      >
                        {truck.active ? (
                          <Trash2 size={19} />
                        ) : (
                          <RotateCcw size={19} />
                        )}
                      </button>
                    </div>
                  </article>
                );
              })}
              {!items.length && (
                <EmptyState
                  title={
                    showInactive
                      ? "Todavía no hay camiones"
                      : "No hay camiones activos"
                  }
                  description="Agregá una unidad con su patente y modelo. Podés informar el kilometraje después."
                />
              )}
              <Pagination
                page={paged.page}
                pageSize={pageSize}
                total={items.length}
                onPage={paged.setPage}
              />
            </section>
          )}
          {editing && (
            <TruckForm
              truck={editing === "new" ? null : editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                trucks.reload();
                onNotify(
                  editing === "new" ? "Camión agregado" : "Camión actualizado",
                );
              }}
            />
          )}
          {odometerTruck && (
            <OdometerForm
              truck={odometerTruck}
              onClose={() => setOdometerTruck(null)}
              onSaved={(updated) => {
                setOdometerTruck(null);
                trucks.reload();
                onNotify(
                  `Kilometraje de ${updated.plate} actualizado a ${formatKm(updated.odometer!)} km`,
                );
              }}
            />
          )}
          {statusTruck && (
            <TruckStatusForm
              truck={statusTruck}
              onClose={() => setStatusTruck(null)}
              onSaved={() => {
                setStatusTruck(null);
                trucks.reload();
                drivers.reload();
                onNotify(
                  statusTruck.active
                    ? "Camión dado de baja. El historial se conserva."
                    : "Camión reactivado",
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { Truck as TruckIcon } from "lucide-react";
import { api, ApiError, send } from "../../api";
import type { Trailer, Truck } from "../../types";
import { Field, Modal } from "../../ui";
import { trailerSaveCommand, type TrailerEditMode as Mode } from "./commands";

export function TrailerForm({
  trailer,
  mode,
  trucks,
  trailers,
  onClose,
  onSaved,
}: {
  trailer: Trailer | null;
  mode: Mode;
  trucks: Truck[];
  trailers: Trailer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reference, setReference] = useState(trailer);
  const [plate, setPlate] = useState(trailer?.plate ?? "");
  const [label, setLabel] = useState(trailer?.label ?? "");
  const [truckId, setTruckId] = useState(trailer?.assignedTruckId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const title = !reference
    ? "Agregar acoplado"
    : mode === "assign"
      ? "Cambiar camión del acoplado"
      : mode === "status"
        ? reference.active
          ? "Dar de baja acoplado"
          : "Reactivar acoplado"
        : "Editar acoplado";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    setFields({});
    try {
      const command = trailerSaveCommand(reference, mode, {
        plate,
        label,
        truckId,
      });
      await send(command.path, command.method, command.body);
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos guardar el acoplado.",
      );
      if (e instanceof ApiError) {
        setFields(e.fields);
        setConflict(e.code === "VERSION_CONFLICT");
      }
      setBusy(false);
    }
  }
  async function refreshReference() {
    if (!reference || busy) return;
    setBusy(true);
    try {
      const result = await api<{ items: Trailer[] }>("/trailers");
      const current = result.items.find((item) => item.id === reference.id);
      if (!current) throw new Error("No se encontró el acoplado.");
      setReference(current);
      setConflict(false);
      setError(
        "Datos actualizados. Conservamos tu selección; revisala antes de guardar.",
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No pudimos actualizar los datos.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose} dismissible={!busy}>
      <form className="admin-form" onSubmit={submit}>
        {reference && (
          <div className="admin-access-person">
            <TruckIcon size={24} />
            <div>
              <strong>{reference.plate}</strong>
              <span>{reference.label}</span>
            </div>
          </div>
        )}
        {mode === "edit" && (
          <div className="grid2">
            <Field label="Patente" error={fields.plate}>
              <input
                required
                maxLength={16}
                autoCapitalize="characters"
                placeholder="Ej. AB 456 CD"
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Acoplado / modelo" error={fields.label}>
              <input
                required
                maxLength={120}
                placeholder="Ej. Acoplado cerealero"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
          </div>
        )}
        {(!reference || mode === "assign") && (
          <>
            {reference && (
              <p className="admin-form-intro">
                Camión actual:{" "}
                <strong>
                  {trucks.find((item) => item.id === reference.assignedTruckId)
                    ?.plate ?? "Sin asignar"}
                </strong>
                . Los viajes y vencimientos del acoplado conservarán su
                historial.
              </p>
            )}
            <Field
              label="Camión asignado (opcional)"
              error={fields.assignedTruckId}
              hint="Un camión admite un solo acoplado. Para elegir un camión ocupado, desasigná primero su acoplado actual."
            >
              <select
                value={truckId}
                onChange={(event) => setTruckId(event.target.value)}
                disabled={busy || reference?.active === false}
              >
                <option value="">Sin asignar</option>
                {trucks
                  .filter((item) => item.active)
                  .map((item) => {
                    const occupant = trailers.find(
                      (t) =>
                        t.assignedTruckId === item.id && t.id !== reference?.id,
                    );
                    return (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={!!occupant}
                      >
                        {item.plate} · {item.label}
                        {occupant ? ` (ocupado por ${occupant.plate})` : ""}
                      </option>
                    );
                  })}
              </select>
            </Field>
            {reference?.active === false && (
              <p className="form-error">
                Reactivá el acoplado antes de asignarle un camión.
              </p>
            )}
          </>
        )}
        {mode === "status" && reference && (
          <p className="admin-form-intro">
            {reference.active
              ? "El acoplado dejará de estar disponible para nuevos viajes y se desasignará de su camión. Se conservarán sus viajes, documentos y servicios."
              : "Volverá a estar disponible y sus vencimientos retomarán el seguimiento. Podés asignarle un camión después de reactivarlo."}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            className="button secondary"
            onClick={refreshReference}
            disabled={busy}
          >
            Actualizar datos
          </button>
        )}
        <div className="admin-form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className={`button ${mode === "status" && reference?.active ? "danger" : "primary"}`}
            disabled={
              busy ||
              conflict ||
              (mode === "assign" && reference?.active === false)
            }
          >
            {busy
              ? "Guardando…"
              : mode === "status"
                ? reference?.active
                  ? "Dar de baja"
                  : "Reactivar"
                : !reference
                  ? "Agregar acoplado"
                  : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

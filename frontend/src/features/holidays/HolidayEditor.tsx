import { useState, type FormEvent } from "react";
import type { HolidayEntry } from "../../holiday-types";
import { Field, Modal } from "../../ui";
import { hasDuplicateHolidayDate } from "./draft";

export function HolidayEditor({
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
    if (hasDuplicateHolidayDate(entries, date, entry?.date ?? null)) {
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

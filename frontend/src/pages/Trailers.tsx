import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Link2,
  Pencil,
  RotateCcw,
  Trash2,
  Truck as TruckIcon,
} from "lucide-react";
import { useData } from "../useData";
import type { PageProps, Trailer, Truck } from "../types";
import { EmptyState, ErrorState, Field, Loading } from "../ui";
import type { TrailerEditMode as Mode } from "../features/trailers/commands";
import { TrailerForm } from "../features/trailers/TrailerForm";
import { TrailerHistory } from "../features/trailers/TrailerHistory";

export function TrailersPanel({
  adding,
  onCloseAdd,
  onNotify,
}: {
  adding: boolean;
  onCloseAdd: () => void;
  onNotify: PageProps["onNotify"];
}) {
  const trailers = useData<{ items: Trailer[] }>("/trailers");
  const trucks = useData<{ items: Truck[] }>("/trucks");
  const [selection, setSelection] = useState<{
    trailer: Trailer;
    mode: Mode;
  } | null>(null);
  const [history, setHistory] = useState<Trailer | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const items = (trailers.data?.items ?? []).filter(
    (t) =>
      (showInactive || t.active) &&
      `${t.plate} ${t.label} ${t.truck?.plate ?? ""}`
        .toLocaleLowerCase("es-AR")
        .includes(search.toLocaleLowerCase("es-AR")),
  );
  const pageCount = Math.max(1, Math.ceil(items.length / 6));
  const currentPage = Math.min(page, pageCount);
  const reload = () => {
    trailers.refresh();
    trucks.refresh();
  };
  const saved = () => {
    const message = adding
      ? "Acoplado agregado"
      : selection?.mode === "assign"
        ? "Asignación actualizada"
        : selection?.mode === "status"
          ? selection.trailer.active
            ? "Acoplado dado de baja. El historial se conserva."
            : "Acoplado reactivado"
          : "Acoplado actualizado";
    onCloseAdd();
    setSelection(null);
    reload();
    onNotify(message);
  };
  return (
    <>
      <div className="admin-toolbar admin-trailer-toolbar">
        <Field label="Buscar acoplado">
          <input
            type="search"
            placeholder="Patente, modelo o camión…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        <span className="admin-result-count">
          {items.length} {items.length === 1 ? "acoplado" : "acoplados"}
        </span>
        <label className="admin-check">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => {
              setShowInactive(event.target.checked);
              setPage(1);
            }}
          />
          <span>Incluir inactivos</span>
        </label>
      </div>
      {(trailers.error || trucks.error) && (
        <ErrorState message={trailers.error || trucks.error} onRetry={reload} />
      )}
      {trailers.loading && !trailers.data && <Loading />}
      {trailers.data && !trailers.error && (
        <section className="admin-surface admin-records">
          <div className="admin-list-header admin-trailer-row">
            <span>Acoplado</span>
            <span>Camión asignado</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {items
            .slice((currentPage - 1) * 6, currentPage * 6)
            .map((trailer) => (
              <article
                key={trailer.id}
                className="admin-record-row admin-trailer-row"
              >
                <div className="admin-row-identity">
                  <span className="admin-item-symbol">
                    <TruckIcon size={24} />
                  </span>
                  <div>
                    <h2>{trailer.plate}</h2>
                    <p>{trailer.label}</p>
                  </div>
                </div>
                <div className="admin-row-secondary">
                  <small className="admin-mobile-label">Camión asignado</small>
                  <strong>{trailer.truck?.plate ?? "Sin asignar"}</strong>
                  {trailer.truck && <small>{trailer.truck.label}</small>}
                </div>
                <span
                  className={`badge ${trailer.active ? "success" : "neutral"}`}
                >
                  {trailer.active ? "Activo" : "Inactivo"}
                </span>
                <div className="admin-row-actions admin-trailer-actions">
                  {trailer.active && (
                    <button
                      className="button secondary"
                      aria-label={`Cambiar camión de ${trailer.plate}`}
                      onClick={() => setSelection({ trailer, mode: "assign" })}
                    >
                      <Link2 size={17} />
                      <span>
                        {trailer.assignedTruckId
                          ? "Cambiar camión"
                          : "Asignar camión"}
                      </span>
                    </button>
                  )}
                  <button
                    className="button ghost admin-icon-button"
                    title="Editar acoplado"
                    aria-label={`Editar acoplado ${trailer.plate}`}
                    onClick={() => setSelection({ trailer, mode: "edit" })}
                  >
                    <Pencil size={18} />
                  </button>
                  <button
                    className="button ghost admin-icon-button"
                    title="Historial"
                    aria-label={`Historial de ${trailer.plate}`}
                    onClick={() => setHistory(trailer)}
                  >
                    <History size={19} />
                  </button>
                  <button
                    className={`button ghost admin-icon-button ${trailer.active ? "admin-destructive-action" : ""}`}
                    title={trailer.active ? "Dar de baja" : "Reactivar"}
                    aria-label={`${trailer.active ? "Dar de baja" : "Reactivar"} acoplado ${trailer.plate}`}
                    onClick={() => setSelection({ trailer, mode: "status" })}
                  >
                    {trailer.active ? (
                      <Trash2 size={19} />
                    ) : (
                      <RotateCcw size={19} />
                    )}
                  </button>
                </div>
              </article>
            ))}
          {!items.length && (
            <EmptyState
              title={search ? "No hay resultados" : "Todavía no hay acoplados"}
              description={
                search
                  ? "Probá con otra patente o modelo."
                  : "Registrá un acoplado y asignale un camión cuando esté disponible."
              }
            />
          )}
          <footer className="admin-pagination">
            <span>
              {items.length
                ? `${(currentPage - 1) * 6 + 1}–${Math.min(currentPage * 6, items.length)} de ${items.length}`
                : "0 registros"}
            </span>
            <div>
              <button
                className="button ghost"
                aria-label="Página anterior"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <span>
                {currentPage} / {pageCount}
              </span>
              <button
                className="button ghost"
                aria-label="Página siguiente"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </footer>
        </section>
      )}
      {(adding || selection) && trucks.data && trailers.data && (
        <TrailerForm
          key={adding ? "new" : `${selection!.trailer.id}-${selection!.mode}`}
          trailer={adding ? null : selection!.trailer}
          mode={adding ? "edit" : selection!.mode}
          trucks={trucks.data.items}
          trailers={trailers.data.items}
          onClose={() => {
            onCloseAdd();
            setSelection(null);
          }}
          onSaved={saved}
        />
      )}
      {history && (
        <TrailerHistory
          trailer={history}
          trucks={trucks.data?.items ?? []}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

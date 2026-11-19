import { useState } from "react";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useData } from "../../useData";
import type { Trailer, Truck } from "../../types";
import { EmptyState, ErrorState, Loading, Modal, formatDate } from "../../ui";

type HistoryItem = {
  id: string;
  action: string;
  createdAt: string;
  actor: { name: string };
  before: Partial<Trailer> | null;
  after: Partial<Trailer> | null;
  reason: string | null;
};

export function TrailerHistory({
  trailer,
  trucks,
  onClose,
}: {
  trailer: Trailer;
  trucks: Truck[];
  onClose: () => void;
}) {
  const history = useData<{ items: HistoryItem[] }>(
    `/trailers/${trailer.id}/history`,
  );
  const [page, setPage] = useState(1);
  const items = history.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(items.length / 6));
  const labels: Record<string, string> = {
    CREATED: "Acoplado agregado",
    UPDATED: "Datos actualizados",
    TRUCK_ASSIGNED: "Camión asignado",
    TRUCK_UNASSIGNED: "Camión desasignado",
    DEACTIVATED: "Acoplado dado de baja",
    REACTIVATED: "Acoplado reactivado",
  };
  const truckName = (id: string | null | undefined) =>
    id
      ? (trucks.find((t) => t.id === id)?.plate ?? "Camión registrado")
      : "Sin asignar";
  return (
    <Modal title={`Historial · ${trailer.plate}`} onClose={onClose}>
      <div className="admin-history-body">
        {history.loading && !history.data && <Loading />}
        {history.error && (
          <ErrorState message={history.error} onRetry={history.refresh} />
        )}
        {items.length > 0 && (
          <ol className="admin-timeline">
            {items.slice((page - 1) * 6, page * 6).map((item) => (
              <li key={item.id}>
                <span className="admin-timeline-dot">
                  <History size={13} />
                </span>
                <div>
                  <strong>{labels[item.action] ?? item.action}</strong>
                  <p>
                    {formatDate(item.createdAt, true)} · {item.actor.name}
                  </p>
                  {item.action === "CREATED" ? (
                    <p>
                      {item.after?.plate} · {item.after?.label}
                      <br />
                      Camión: {truckName(item.after?.assignedTruckId)}
                    </p>
                  ) : (
                    item.before?.assignedTruckId !==
                      item.after?.assignedTruckId && (
                      <p>
                        {truckName(item.before?.assignedTruckId)} →{" "}
                        {truckName(item.after?.assignedTruckId)}
                      </p>
                    )
                  )}
                  {item.action === "UPDATED" && (
                    <p>
                      {item.before?.plate} · {item.before?.label} →{" "}
                      {item.after?.plate} · {item.after?.label}
                    </p>
                  )}
                  {item.reason && <p>{item.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {!items.length && !history.loading && !history.error && (
          <EmptyState title="Sin movimientos registrados" />
        )}
        {pageCount > 1 && (
          <div className="admin-pagination">
            <span>
              {page} / {pageCount}
            </span>
            <div>
              <button
                className="button ghost"
                aria-label="Página anterior"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="button ghost"
                aria-label="Página siguiente"
                disabled={page === pageCount}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
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

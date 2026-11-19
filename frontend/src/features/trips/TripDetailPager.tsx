import { ChevronLeft, ChevronRight } from "lucide-react";

export function TripDetailPager({
  page,
  total,
  onPage,
  label = "Página",
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (total <= 1) return null;
  return (
    <div className="trip-detail-pagination">
      <span>
        {label} {page + 1} de {total}
      </span>
      <div>
        <button
          type="button"
          className="button ghost"
          aria-label="Página anterior"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={19} />
        </button>
        <button
          type="button"
          className="button ghost"
          aria-label="Página siguiente"
          disabled={page >= total - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={19} />
        </button>
      </div>
    </div>
  );
}

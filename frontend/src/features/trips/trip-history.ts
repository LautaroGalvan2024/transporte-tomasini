import type { Role, Trip } from "../../types.ts";
import { manualDistanceEnabled } from "./manual-distance-enabled.ts";

type TripAuditSnapshot = {
  trailerId?: string | null;
  trailer?: { plate: string } | null;
  km100?: number | null;
  km100Context?: { mode: string } | null;
};

export type TripAuditEvent = {
  id: string;
  action: string;
  createdAt: string;
  actor?: { name: string } | null;
  reason?: string | null;
  before?: TripAuditSnapshot | null;
  after?: TripAuditSnapshot | null;
};
export function trailerHistoryChange(event: TripAuditEvent) {
  if (!event.after || !("trailerId" in event.after)) return "";
  const after = event.after.trailer?.plate || "Sin acoplado registrado";
  if (event.action === "CREATED") return `Acoplado: ${after}`;
  if (
    event.action === "UPDATED" &&
    (event.before?.trailerId ?? null) !== event.after.trailerId
  )
    return `Acoplado: ${event.before?.trailer?.plate || "Sin acoplado registrado"} → ${after}`;
  return "";
}
export function km100HistoryChange(
  event: TripAuditEvent,
  formatKm: (value: number) => string,
) {
  if (!event.after || !("km100" in event.after)) return "";
  const describe = (snapshot: TripAuditEvent["after"]) =>
    snapshot?.km100 == null
      ? "Sin informar"
      : `${formatKm(snapshot.km100)} km${snapshot.km100Context?.mode === "PENDING" ? " (pendiente de validar)" : ""}`;
  if (event.action === "CREATED" && event.after.km100 != null)
    return `Km al 100%: ${describe(event.after)}`;
  if (
    event.action === "UPDATED" &&
    ((event.before?.km100 ?? null) !== event.after.km100 ||
      event.before?.km100Context?.mode !== event.after.km100Context?.mode)
  )
    return `Km al 100%: ${describe(event.before)} → ${describe(event.after)}`;
  return "";
}

// Every character remains available: pages split at whitespace without trimming.
export function paginateDetailText(
  text: string,
  maxChars = 420,
  maxBreaks = 6,
): string[] {
  if (!text) return [];
  const pages: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    let breaks = 0;
    for (let index = start; index < end; index++) {
      if (text[index] === "\n" && ++breaks === maxBreaks) {
        end = index + 1;
        break;
      }
    }
    if (end < text.length && text[end - 1] !== "\n") {
      const candidate = text.slice(start, end);
      const lastSpace = Math.max(
        candidate.lastIndexOf(" "),
        candidate.lastIndexOf("\n"),
      );
      if (lastSpace >= candidate.length * 0.65) end = start + lastSpace + 1;
      if (
        /^[\uDC00-\uDFFF]$/.test(text[end]) &&
        /^[\uD800-\uDBFF]$/.test(text[end - 1])
      )
        end--;
    }
    pages.push(text.slice(start, end));
    start = end;
  }
  return pages;
}
export function paginateTripHistory(events: TripAuditEvent[]) {
  const pages: {
    event: TripAuditEvent;
    reason: string;
    part: number;
    parts: number;
  }[][] = [];
  let short: (typeof pages)[number] = [];
  const flush = () => {
    if (short.length) {
      pages.push(short);
      short = [];
    }
  };
  for (const event of events) {
    const reason = event.reason || "";
    const long = reason.length > 110 || reason.includes("\n");
    if (long) {
      flush();
      const parts = paginateDetailText(reason);
      parts.forEach((text, index) =>
        pages.push([
          { event, reason: text, part: index + 1, parts: parts.length },
        ]),
      );
    } else {
      short.push({ event, reason, part: 1, parts: 1 });
      if (short.length === 3) flush();
    }
  }
  flush();
  return pages;
}

const auditLabels: Record<string, string> = {
  CREATED: "Viaje registrado",
  UPDATED: "Viaje corregido",
  REVIEWED: "Viaje revisado",
  CANCELLED: "Viaje anulado",
};

export function presentTripHistory(
  events: TripAuditEvent[],
  formatKm: (value: number) => string,
) {
  return paginateTripHistory(events).map((page) =>
    page.map((entry) => ({
      ...entry,
      title:
        auditLabels[entry.event.action] ||
        entry.event.action ||
        "Cambio registrado",
      trailerChange: trailerHistoryChange(entry.event),
      km100Change: km100HistoryChange(entry.event, formatKm),
    })),
  );
}

export function tripDetailPermissions(trip: Trip, role: Role) {
  const canEdit =
    trip.status === "ACTIVE" &&
    (trip.mileageMode === "DISTANCE"
      ? role === "ADMIN" && manualDistanceEnabled
      : role === "ADMIN" || !trip.reviewedAt);
  return {
    canEdit,
    canReview: role === "ADMIN" && !trip.reviewedAt && trip.status === "ACTIVE",
    canCancel: role === "ADMIN" && trip.status === "ACTIVE",
    showClose: !canEdit,
  };
}

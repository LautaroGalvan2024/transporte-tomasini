import type { Trailer } from "../../types";

export type TrailerEditMode = "edit" | "assign" | "status";

type TrailerFields = { plate: string; label: string; truckId: string };
type TrailerReference = Pick<Trailer, "id" | "version" | "active">;

export type TrailerSaveCommand =
  | {
      kind: "create";
      path: "/trailers";
      method: "POST";
      body: { plate: string; label: string; assignedTruckId: string | null };
    }
  | {
      kind: "assign";
      path: string;
      method: "PATCH";
      body: { assignedTruckId: string | null; version: number };
    }
  | { kind: "deactivate"; path: string; method: "DELETE"; body: undefined }
  | {
      kind: "reactivate";
      path: string;
      method: "PATCH";
      body: { active: true; version: number };
    }
  | {
      kind: "edit";
      path: string;
      method: "PATCH";
      body: { plate: string; label: string; version: number };
    };

export function trailerSaveCommand(
  reference: TrailerReference | null,
  mode: TrailerEditMode,
  { plate, label, truckId }: TrailerFields,
): TrailerSaveCommand {
  if (!reference)
    return {
      kind: "create",
      path: "/trailers",
      method: "POST",
      body: { plate, label, assignedTruckId: truckId || null },
    };
  if (mode === "assign")
    return {
      kind: "assign",
      path: `/trailers/${reference.id}/truck`,
      method: "PATCH",
      body: { assignedTruckId: truckId || null, version: reference.version },
    };
  if (mode === "status")
    return reference.active
      ? {
          kind: "deactivate",
          path: `/trailers/${reference.id}`,
          method: "DELETE",
          body: undefined,
        }
      : {
          kind: "reactivate",
          path: `/trailers/${reference.id}`,
          method: "PATCH",
          body: { active: true, version: reference.version },
        };
  return {
    kind: "edit",
    path: `/trailers/${reference.id}`,
    method: "PATCH",
    body: { plate, label, version: reference.version },
  };
}

import type { Obligation, Settings } from "../../types.ts";
import { businessInstant, optionalNumber } from "./formatting.ts";

export type ObligationOwner = "truck" | "trailer" | "driver";
export type ObligationStep = 0 | 1 | 2;
export type RenewalStep = 0 | 1;

export interface ObligationFormValues {
  kind: Obligation["kind"];
  title: string;
  ownerType: ObligationOwner;
  ownerId: string;
  dueDate: string;
  dueKm: string;
  intervalMonths: string;
  intervalKm: string;
  warningDays: string;
  warningKm: string;
  notes: string;
  active: boolean;
  initialRecord: boolean;
  performedAt: string;
  odometer: string;
}

export interface RenewalFormValues {
  performedAt: string;
  odometer: string;
  nextDueDate: string;
  nextDueKm: string;
  notes: string;
}

export interface ObligationPayload {
  title: string;
  kind: Obligation["kind"];
  truckId: string | null;
  trailerId: string | null;
  driverId: string | null;
  dueDate: string | null;
  dueKm: number | null;
  intervalMonths: number | null;
  intervalKm: number | null;
  warningDays: number;
  warningKm: number;
  notes: string | null;
  active?: boolean;
  version?: number;
  initialRecord?: { performedAt: string; odometer: number | null };
}

export interface RenewalPayload {
  performedAt: string;
  odometer: number | null;
  nextDueDate: string | null;
  nextDueKm: number | null;
  notes: string | null;
  version: number;
}

/** Capture the defaults at form mount, including the existing unloaded-settings fallback. */
export function obligationFormDefaults(
  obligation: Obligation | null,
  defaults: Pick<Settings, "warningDays" | "warningKm"> | null,
  performedAt: string,
): ObligationFormValues {
  return {
    kind: obligation?.kind || "SERVICE",
    title: obligation?.title || "",
    ownerType: obligation?.trailerId
      ? "trailer"
      : obligation?.driverId
        ? "driver"
        : "truck",
    ownerId:
      obligation?.truckId ||
      obligation?.trailerId ||
      obligation?.driverId ||
      "",
    dueDate: obligation?.dueDate?.slice(0, 10) || "",
    dueKm: obligation?.dueKm?.toString() || "",
    intervalMonths: obligation?.intervalMonths?.toString() || "",
    intervalKm: obligation?.intervalKm?.toString() || "",
    warningDays: String(obligation?.warningDays ?? defaults?.warningDays ?? 30),
    warningKm: String(obligation?.warningKm ?? defaults?.warningKm ?? 1000),
    notes: obligation?.notes || "",
    active: obligation?.active ?? true,
    initialRecord: false,
    performedAt,
    odometer: "",
  };
}

export function addMonths(date: string, months: number): string {
  if (
    !/^\d{4}-\d{2}-\d{2}/.test(date) ||
    !Number.isInteger(months) ||
    months < 1 ||
    months > 120
  )
    return "";
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const lastDay = new Date(
    Date.UTC(year, month - 1 + months + 1, 0),
  ).getUTCDate();
  const result = new Date(
    Date.UTC(year, month - 1 + months, Math.min(day, lastDay)),
  );
  return result.toISOString().slice(0, 10);
}

export function renewalFormDefaults(
  obligation: Pick<Obligation, "intervalMonths">,
  performedAt: string,
  today: string,
): RenewalFormValues {
  return {
    performedAt,
    odometer: "",
    nextDueDate: obligation.intervalMonths
      ? addMonths(today, obligation.intervalMonths)
      : "",
    nextDueKm: "",
    notes: "",
  };
}

export function buildObligationPayload(
  values: ObligationFormValues,
  obligation: Pick<Obligation, "version"> | null,
): ObligationPayload {
  return {
    title: values.title.trim(),
    kind: values.kind,
    truckId: values.ownerType === "truck" ? values.ownerId : null,
    trailerId: values.ownerType === "trailer" ? values.ownerId : null,
    driverId: values.ownerType === "driver" ? values.ownerId : null,
    dueDate: values.dueDate || null,
    dueKm: values.ownerType === "truck" ? optionalNumber(values.dueKm) : null,
    intervalMonths: optionalNumber(values.intervalMonths),
    intervalKm:
      values.ownerType === "truck" ? optionalNumber(values.intervalKm) : null,
    warningDays: Number(values.warningDays),
    warningKm: Number(values.warningKm),
    notes: values.notes.trim() || null,
    ...(obligation
      ? { active: values.active, version: obligation.version }
      : {}),
    ...(!obligation && values.kind === "SERVICE" && values.initialRecord
      ? {
          initialRecord: {
            performedAt: businessInstant(values.performedAt),
            odometer:
              values.ownerType === "truck"
                ? optionalNumber(values.odometer)
                : null,
          },
        }
      : {}),
  };
}

export function buildRenewalPayload(
  values: RenewalFormValues,
  obligation: Pick<Obligation, "kind" | "truckId" | "version">,
): RenewalPayload {
  return {
    performedAt: businessInstant(values.performedAt),
    odometer:
      obligation.kind === "SERVICE" && obligation.truckId
        ? optionalNumber(values.odometer)
        : null,
    nextDueDate: values.nextDueDate || null,
    nextDueKm: obligation.truckId ? optionalNumber(values.nextDueKm) : null,
    notes: values.notes.trim() || null,
    version: obligation.version,
  };
}

type ObligationField =
  | keyof ObligationPayload
  | "initialRecord.performedAt"
  | "initialRecord.odometer";

const obligationFieldSteps = {
  title: 0,
  kind: 0,
  truckId: 0,
  trailerId: 0,
  driverId: 0,
  notes: 0,
  dueDate: 1,
  dueKm: 1,
  intervalMonths: 1,
  intervalKm: 1,
  warningDays: 1,
  warningKm: 1,
} satisfies Partial<Record<ObligationField, ObligationStep>>;

const renewalFieldSteps = {
  performedAt: 0,
  odometer: 0,
  notes: 0,
} satisfies Partial<Record<keyof RenewalPayload, RenewalStep>>;

/** Unmapped errors stay on the current step, matching the existing submit handlers. */
function errorStep(
  fields: Record<string, string>,
  mapping: Readonly<Record<string, number>>,
  currentStep: number,
): number {
  const steps = Object.keys(fields)
    .filter((field) => Object.hasOwn(mapping, field))
    .map((field) => mapping[field]);
  return steps.length ? Math.min(...steps) : currentStep;
}

export function obligationErrorStep(
  fields: Record<string, string>,
  currentStep: number,
): number {
  return errorStep(fields, obligationFieldSteps, currentStep);
}

export function renewalErrorStep(
  fields: Record<string, string>,
  currentStep: number,
): number {
  return errorStep(fields, renewalFieldSteps, currentStep);
}



export const TIMEZONE = "America/Argentina/Buenos_Aires";

export const dateToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export const dateTimeInput = (value = new Date().toISOString()) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(" ", "T");

export const businessInstant = (value: string) =>
  new Date(`${value}:00-03:00`).toISOString();

export const optionalNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);

export const dateLabel = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: TIMEZONE,
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(
        new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value),
      )
    : "Sin definir";

export const statusText = (status: string) =>
  ({
    OVERDUE: "Vencido",
    UPCOMING: "Por vencer",
    OK: "Al día",
    UNCONFIGURED: "Sin programar",
    SENT: "Enviado",
    FAILED: "No enviado",
    PENDING: "Pendiente",
    SENDING: "Enviando",
    SUPERSEDED: "Reemplazado",
    CANCELLED: "Resuelto",
  })[status] || status;

export const err = (error: unknown) =>
  error instanceof Error ? error.message : "No pudimos completar la acción.";

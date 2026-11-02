import "./load-env.js";

export const BUSINESS_TIMEZONE = "America/Argentina/Buenos_Aires";
export function validateDatabaseUrl(
  raw: string | undefined,
  purpose: "app" | "migration" = "app",
) {
  if (!raw) throw new Error("Falta la conexión PostgreSQL de Tomasini.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Conexión PostgreSQL inválida.");
  }
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  const suffix = purpose === "app" ? "app" : "migrator";
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !/^tomasini_[a-z0-9_]+$/.test(database) ||
    !new RegExp(`^tomasini_[a-z0-9_]+_${suffix}$`).test(username)
  ) {
    throw new Error(
      "Destino rechazado: se requiere base tomasini_* y rol exclusivo de la función solicitada.",
    );
  }
  const schema = url.searchParams.get("schema");
  if (schema && schema !== "tomasini")
    throw new Error("El esquema debe ser tomasini.");
  if (url.searchParams.has("options"))
    throw new Error("No se admiten opciones SQL en la conexión.");
  return { url, database, username };
}

export function getConfig() {
  const production = process.env.NODE_ENV === "production";
  const databaseUrl = process.env.DATABASE_URL;
  validateDatabaseUrl(databaseUrl);
  const origin = process.env.APP_ORIGIN ?? "http://127.0.0.1:5175";
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.origin !== origin ||
    (production && parsedOrigin.protocol !== "https:")
  )
    throw new Error(
      "APP_ORIGIN debe ser un origen exacto; en producción debe usar HTTPS.",
    );
  const port = Number(process.env.PORT ?? (production ? 3102 : 3002));
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Puerto inválido.");
  const poolMax = Number(process.env.DB_POOL_MAX ?? 4);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 10)
    throw new Error("DB_POOL_MAX debe estar entre 1 y 10.");
  return {
    production,
    databaseUrl: databaseUrl!,
    origin,
    port,
    poolMax,
    host: process.env.HOST ?? "127.0.0.1",
    cookieName: production ? "__Host-tomasini_session" : "tomasini_session",
    sessionDays: 14,
  };
}

export function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.SMTP_PORT,
  );
}

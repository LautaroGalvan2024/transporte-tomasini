import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getConfig, validateDatabaseUrl } from "./config.js";

export type Tx = Prisma.TransactionClient;
let client: PrismaClient | undefined;
export function getDb() {
  if (!client) {
    const { databaseUrl, poolMax } = getConfig();
    const adapter = new PrismaPg(
      {
        connectionString: databaseUrl,
        max: poolMax,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      },
      { schema: "tomasini" },
    );
    client = new PrismaClient({ adapter });
  }
  return client;
}

export async function assertDatabaseScope(db: PrismaClient = getDb()) {
  const expected = validateDatabaseUrl(getConfig().databaseUrl);
  const rows = await db.$queryRaw<
    Array<{
      database: string;
      username: string;
      elevated: boolean;
      owner: boolean;
      publicAccess: boolean;
      canCreate: boolean;
    }>
  >`
    SELECT current_database() AS database, current_user AS username,
      (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls) AS elevated,
      (d.datdba = r.oid) AS owner,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a WHERE a.grantee = 0) AS "publicAccess",
      has_schema_privilege(current_user, 'tomasini', 'CREATE') AS "canCreate"
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database() WHERE r.rolname = current_user`;
  const row = rows[0];
  if (
    !row ||
    row.database !== expected.database ||
    row.username !== expected.username ||
    row.elevated ||
    row.owner ||
    row.publicAccess ||
    row.canCreate
  ) {
    throw new Error(
      "La base o sus permisos no cumplen el aislamiento de Tomasini.",
    );
  }
}

export function isRetryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  // Raw SQL keeps PostgreSQL's SQLSTATE in adapter metadata instead of P2034.
  // Retry only aborted transactions, never constraints or uncertain outcomes.
  const adapter = error.meta?.driverAdapterError;
  const cause =
    adapter && typeof adapter === "object" && "cause" in adapter
      ? adapter.cause
      : undefined;
  const originalCode =
    cause && typeof cause === "object" && "originalCode" in cause
      ? cause.originalCode
      : undefined;
  return [error.meta?.code, originalCode].some(
    (code) => code === "40001" || code === "40P01",
  );
}

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getDb().$transaction(run, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 15_000,
      });
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 2) continue;
      throw error;
    }
  }
}

export async function lockTrucks(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.$queryRaw`SELECT id FROM tomasini."Truck" WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function lockTrailers(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort())
    await tx.$queryRaw`SELECT id FROM tomasini."Trailer" WHERE id = ${id}::uuid FOR UPDATE`;
}

export async function disconnect() {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

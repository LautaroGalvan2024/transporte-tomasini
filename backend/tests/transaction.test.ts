import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  assertDatabaseScope,
  disconnect,
  getDb,
  isRetryableTransactionError,
  transaction,
} from "../src/db.js";
import { validateDatabaseUrl } from "../src/config.js";

function knownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("Test database error", {
    code,
    clientVersion: Prisma.prismaVersion.client,
    meta,
  });
}

test("reintenta conflictos serializables de Prisma y SQL crudo, sin repetir otros errores", () => {
  assert.equal(isRetryableTransactionError(knownError("P2034")), true);
  for (const code of ["40001", "40P01"]) {
    assert.equal(
      isRetryableTransactionError(knownError("P2010", { code })),
      true,
    );
    assert.equal(
      isRetryableTransactionError(
        knownError("P2010", {
          driverAdapterError: new Error("Adapter error", {
            cause: { originalCode: code, kind: "TransactionWriteConflict" },
          }),
        }),
      ),
      true,
    );
  }
  for (const error of [
    knownError("P2002"),
    knownError("P2010"),
    knownError("P2010", { code: "23505" }),
    knownError("P2010", { code: "40003" }),
    knownError("P2010", { driverAdapterError: { cause: null } }),
    new Error("40001"),
    { code: "P2034" },
  ])
    assert.equal(isRetryableTransactionError(error), false);
});

const enabled =
  process.env.TOMASINI_INTEGRATION === "1" || process.env.NODE_ENV === "test";
test(
  "PostgreSQL: un FOR UPDATE sobre una versión reemplazada repite toda la transacción una sola vez",
  { skip: !enabled, timeout: 30_000 },
  async () => {
    const target = validateDatabaseUrl(process.env.DATABASE_URL);
    assert.equal(target.database, "tomasini_test");
    assert.ok(["127.0.0.1", "localhost"].includes(target.url.hostname));
    await assertDatabaseScope();
    const db = getDb();
    const ids: string[] = [];
    try {
      for (const label of ["snapshot", "rollback marker"]) {
        const truck = await db.truck.create({
          data: {
            plate: `TX${randomUUID().replaceAll("-", "").slice(0, 12)}`,
            label,
            initialOdometer: 0,
            initialOdometerAt: new Date(),
          },
        });
        ids.push(truck.id);
      }
      let attempts = 0;
      const label = await transaction(async (tx) => {
        attempts++;
        await tx.truck.update({
          where: { id: ids[1] },
          data: { initialOdometer: { increment: 1 } },
        });
        await tx.truck.findUniqueOrThrow({ where: { id: ids[0] } });
        if (attempts === 1) {
          // A separate connection commits after this serializable snapshot.
          await db.truck.update({
            where: { id: ids[0] },
            data: { label: "committed elsewhere" },
          });
        }
        await tx.$queryRaw`SELECT id FROM tomasini."Truck" WHERE id = ${ids[0]}::uuid FOR UPDATE`;
        return (await tx.truck.findUniqueOrThrow({ where: { id: ids[0] } }))
          .label;
      });
      assert.equal(attempts, 2);
      assert.equal(label, "committed elsewhere");
      assert.equal(
        (await db.truck.findUniqueOrThrow({ where: { id: ids[1] } }))
          .initialOdometer,
        1,
        "El intento abortado debe revertir también sus escrituras anteriores.",
      );
    } finally {
      await db.truck.deleteMany({ where: { id: { in: ids } } });
      await disconnect();
    }
  },
);

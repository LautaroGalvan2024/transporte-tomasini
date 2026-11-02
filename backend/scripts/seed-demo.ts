import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  assertDatabaseScope,
  disconnect,
  getDb,
  transaction,
} from "../src/db.js";
import { validateDatabaseUrl } from "../src/config.js";
import { hashPassword } from "../src/password.js";

async function main() {
  const target = validateDatabaseUrl(process.env.DATABASE_URL);
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(target.url.hostname) ||
    target.database !== "tomasini_dev" ||
    !process.argv.includes("--local-demo")
  )
    throw new Error(
      "La demo exige --local-demo, conexión local y base tomasini_dev.",
    );
  await assertDatabaseScope();
  if (await getDb().user.count())
    throw new Error(
      "La demo solo se carga en una base vacía. No se modificaron datos.",
    );
  const adminPassword = randomBytes(18).toString("base64url"),
    driverPassword = randomBytes(18).toString("base64url");
  const adminHash = await hashPassword(adminPassword),
    driverHash = await hashPassword(driverPassword);
  const now = new Date(),
    base = new Date(now.getTime() - 40 * 86_400_000);
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const credentialsDir = fileURLToPath(
    new URL("../../.local/", import.meta.url),
  );
  await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(
    `${credentialsDir}/demo-credentials.json`,
    JSON.stringify(
      {
        warning: "Solo datos ficticios locales",
        admin: { username: "admin.demo", password: adminPassword },
        driver: { username: "martin.demo", password: driverPassword },
        otherDrivers: ["carlos.demo", "diego.demo"].map((username) => ({
          username,
          password: driverPassword,
        })),
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  await transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        name: "Nicolás · Demo",
        username: "admin.demo",
        passwordHash: adminHash,
        role: "ADMIN",
        mustChangePassword: false,
      },
    });
    const specs = [
      {
        name: "Martín González",
        username: "martin.demo",
        plate: "AF482KT",
        label: "Mercedes-Benz Actros",
        initial: 284_320,
      },
      {
        name: "Carlos Rodríguez",
        username: "carlos.demo",
        plate: "AE731RM",
        label: "Scania R450",
        initial: 412_100,
      },
      {
        name: "Diego Fernández",
        username: "diego.demo",
        plate: "AG204LP",
        label: "Volvo FH",
        initial: 198_450,
      },
    ];
    for (let index = 0; index < specs.length; index++) {
      const spec = specs[index];
      const truck = await tx.truck.create({
        data: {
          plate: spec.plate,
          label: spec.label,
          initialOdometer: spec.initial,
          initialOdometerAt: base,
        },
      });
      const account = await tx.user.create({
        data: {
          name: spec.name,
          username: spec.username,
          passwordHash: driverHash,
          role: "DRIVER",
          mustChangePassword: false,
          driver: { create: { assignedTruckId: truck.id, phone: null } },
        },
        include: { driver: true },
      });
      let reading = spec.initial;
      const routes = [
        ["Rosario", "Buenos Aires", 310],
        ["Buenos Aires", "Córdoba", 695],
        ["Córdoba", "Rosario", 405],
      ] as const;
      for (let i = 0; i < 6; i++) {
        const departureAt = new Date(
            now.getTime() - (18 - i * 3) * 86_400_000 + index * 3_600_000,
          ),
          arrivalAt = new Date(departureAt.getTime() + 8 * 3_600_000);
        const [origin, destination, distance] = routes[i % routes.length];
        const trip = await tx.trip.create({
          data: {
            clientRequestId: randomUUID(),
            requestHash: createHash("sha256")
              .update(randomUUID())
              .digest("hex"),
            createdById: account.id,
            driverId: account.driver!.id,
            truckId: truck.id,
            origin,
            destination,
            departureAt,
            arrivalAt,
            startKm: reading,
            endKm: reading + distance,
            allowance: i % 2 === 0 ? "18500.00" : null,
            notes: i === 4 ? "Descarga completada sin demoras." : null,
            ...(i < 4
              ? {
                  reviewedAt: new Date(arrivalAt.getTime() + 3_600_000),
                  reviewedById: admin.id,
                }
              : {}),
          },
        });
        await tx.audit.create({
          data: {
            entity: "TRIP",
            entityId: trip.id,
            actorId: account.id,
            action: "CREATED",
            after: { demo: true, origin, destination, distanceKm: distance },
          },
        });
        reading += distance;
      }
      const service = await tx.obligation.create({
        data: {
          title: "Service de aceite y filtros",
          kind: "SERVICE",
          truckId: truck.id,
          dueKm: reading + (index === 0 ? 650 : 8_000),
          dueDate: new Date(day(index === 0 ? 20 : 90)),
          intervalKm: 20_000,
          intervalMonths: 6,
        },
      });
      await tx.renewal.create({
        data: {
          obligationId: service.id,
          performedAt: new Date(base.getTime() - 20 * 86_400_000),
          odometer: spec.initial - 5_000,
          nextDueDate: service.dueDate,
          nextDueKm: service.dueKm,
          createdById: admin.id,
          notes: "Registro inicial de demostración.",
        },
      });
      await tx.obligation.create({
        data: {
          title: "Seguro del camión",
          kind: "DOCUMENT",
          truckId: truck.id,
          dueDate: new Date(day(index === 1 ? -3 : 60)),
          intervalMonths: 12,
        },
      });
      await tx.obligation.create({
        data: {
          title: "Patente",
          kind: "DOCUMENT",
          truckId: truck.id,
          dueDate: new Date(day(index === 2 ? 12 : 55)),
        },
      });
      await tx.obligation.create({
        data: {
          title: "Licencia de conducir",
          kind: "DOCUMENT",
          driverId: account.driver!.id,
          dueDate: new Date(day(index === 0 ? 25 : 180)),
        },
      });
    }
  });
  console.log(
    "Demo local creada: tres camiones, tres choferes, viajes e historial. Accesos guardados en .local/demo-credentials.json.",
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error && !("code" in error)
        ? error.message
        : "No se pudo cargar la demo local.",
    );
    process.exitCode = 1;
  })
  .finally(disconnect);

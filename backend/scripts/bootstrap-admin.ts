import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, assertDatabaseScope, disconnect } from "../src/db.js";
import { hashPassword } from "../src/password.js";
import { username as usernameSchema, text } from "../src/validation.js";

async function main() {
  const args = Object.fromEntries(
    process.argv
      .slice(2)
      .filter((a) => a.startsWith("--") && a.includes("="))
      .map((a) => {
        const index = a.indexOf("=");
        return [a.slice(2, index), a.slice(index + 1)];
      }),
  );
  const username = usernameSchema.parse(args.username ?? "admin");
  const name = text(120).parse(args.name ?? "Administrador");
  const path =
    args["credentials-file"] ??
    fileURLToPath(new URL("../../.local/admin-inicial.json", import.meta.url));
  if (!isAbsolute(path))
    throw new Error("El archivo privado debe usar una ruta absoluta.");
  if (process.env.NODE_ENV === "production" && !args["credentials-file"])
    throw new Error("En producción indicá un archivo privado explícito.");
  await assertDatabaseScope();
  if (await getDb().user.count({ where: { role: "ADMIN" } }))
    throw new Error(
      "Ya existe administración. Este comando solo inicializa una instalación vacía.",
    );
  const password = randomBytes(24).toString("base64url");
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Exclusive creation avoids overwriting access details from an earlier operation.
  await writeFile(
    resolve(path),
    JSON.stringify({ username, password, mustChangePassword: true }, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  await getDb().user.create({
    data: {
      username,
      name,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      mustChangePassword: true,
    },
  });
  console.log(
    "Administrador creado. Acceso inicial guardado en el archivo privado indicado; requiere cambio de contraseña.",
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error && !("code" in error)
        ? error.message
        : "No se pudo crear el administrador.",
    );
    process.exitCode = 1;
  })
  .finally(disconnect);

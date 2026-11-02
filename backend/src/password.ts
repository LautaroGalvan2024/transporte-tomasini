import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";

let working = 0;
const waiting: Array<() => void> = [];
async function boundedScrypt(password: string, salt: Buffer) {
  if (working >= 4) {
    if (waiting.length >= 12)
      throw new AppError(
        429,
        "Hay muchos intentos de acceso. Esperá un momento.",
        "RATE_LIMIT",
      );
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else working++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
        (error, value) => (error ? reject(error) : resolve(value)),
      ),
    );
  } finally {
    const next = waiting.shift();
    if (next) next();
    else working--;
  }
}
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new AppError(
      400,
      "La contraseña debe tener entre 12 y 128 caracteres.",
    );
  const salt = randomBytes(16);
  const hash = await boundedScrypt(password, salt);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored?: string | null) {
  if (password.length > 128) return false;
  const parts = stored?.split("$");
  const validFormat =
    parts?.length === 6 &&
    parts[0] === "scrypt" &&
    parts[1] === "16384" &&
    parts[2] === "8" &&
    parts[3] === "1" &&
    /^[a-f0-9]{32}$/.test(parts[4]) &&
    /^[a-f0-9]{128}$/.test(parts[5]);
  const salt = Buffer.from(validFormat ? parts![4] : "00".repeat(16), "hex");
  const expected = Buffer.from(
    validFormat ? parts![5] : "00".repeat(64),
    "hex",
  );
  const actual = await boundedScrypt(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(validFormat);
}

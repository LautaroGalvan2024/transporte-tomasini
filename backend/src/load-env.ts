import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
const backend = new URL("../", import.meta.url);
// Explicit environment always wins. Development secrets are never read in production.
if (process.env.NODE_ENV === "test")
  dotenv.config({
    path: fileURLToPath(new URL(".env.test", backend)),
    quiet: true,
  });
else {
  if (process.env.NODE_ENV !== "production")
    dotenv.config({
      path: fileURLToPath(new URL(".env.development", backend)),
      quiet: true,
    });
  dotenv.config({ path: fileURLToPath(new URL(".env", backend)), quiet: true });
  if (process.env.NODE_ENV !== "production")
    dotenv.config({
      path: fileURLToPath(new URL("../.env", backend)),
      quiet: true,
    });
}

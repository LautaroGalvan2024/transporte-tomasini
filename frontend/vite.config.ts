import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { stampFrontend } from "./build-version.ts";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "tomasini-frontend-version",
      apply: "build",
      enforce: "post",
      writeBundle({ dir }) {
        if (!dir) throw new Error("El frontend requiere un directorio de salida.");
        stampFrontend(dir);
      },
    },
  ],
  server: {
    host: "127.0.0.1", port: 5175, strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3002" },
  },
  build: { outDir: "dist" },
});

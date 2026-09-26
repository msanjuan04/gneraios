import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Los tests de base de datos arrancan un Postgres real (PGlite) por fichero.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

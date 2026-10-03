import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // tests run outside React Server Components; the real guard is checked by `next build`
      "server-only": fileURLToPath(new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    // fixture mode unless a test opts into the live /api path (NEXT_PUBLIC_MOCK=0)
    env: { NEXT_PUBLIC_MOCK: "1" },
  },
});

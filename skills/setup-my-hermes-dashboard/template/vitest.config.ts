import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "ui",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/server/**", "src/routes/api/**"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "server",
          environment: "node",
          globals: true,
          include: ["src/server/**/*.test.ts", "src/routes/api/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
    ],
  },
});

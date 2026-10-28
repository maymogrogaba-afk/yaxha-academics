import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" throws outside Next.js; tests run on the server anyway.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://yaxha:yaxha@localhost:5432/yaxha_test",
      TOKEN_ENCRYPTION_KEY: "0".repeat(64),
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      APP_URL: "http://localhost:3000",
      AI_MAX_REQUESTS_PER_HOUR: "1000",
    },
  },
});

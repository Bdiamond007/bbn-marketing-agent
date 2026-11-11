import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "packages/i18n/scripts/**/*.test.ts"],
          exclude: ["**/*.contract.test.ts", "**/*.db.test.ts", "**/node_modules/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "contracts",
          include: ["packages/*/src/**/*.contract.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "db",
          include: ["packages/*/src/**/*.db.test.ts"],
          environment: "node",
          globalSetup: ["packages/test-utils/src/db-global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});

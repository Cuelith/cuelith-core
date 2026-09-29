import { defineConfig } from "@playwright/test";

// Si prova l'app gia' compilata (`pnpm build`): e' quella che userebbe l'operatore.
export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Ogni prova avvia la sua istanza di Electron con un profilo separato.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
});

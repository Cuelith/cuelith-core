import { defineConfig } from "@playwright/test";

// Schermate per il sito (cartella `site`): si lanciano a mano con
// `pnpm site:shots`, non fanno parte delle prove.
export default defineConfig({
  testDir: "site",
  timeout: 300_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results-site",
});

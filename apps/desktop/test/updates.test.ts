import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadInstallation,
  loadPreferences,
  resetInstallation,
  savePreferences,
} from "../src/installation.js";
import { FIRST_CHECK_MS, Updates, type UpdateState, type Updater } from "../src/updates.js";

const folder = () => mkdtempSync(path.join(tmpdir(), "cuelith-desktop-"));

describe("ID di installazione e preferenze (decisione 0004)", () => {
  it("l'ID nasce al primo avvio, resta uguale, si rigenera a richiesta", async () => {
    const dir = folder();
    const first = await loadInstallation(dir);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await loadInstallation(dir)).id).toBe(first.id);
    const fresh = await resetInstallation(dir);
    expect(fresh.id).not.toBe(first.id);
    expect((await loadInstallation(dir)).id).toBe(fresh.id);
  });

  it("un file rovinato non blocca l'avvio: nuovo ID", async () => {
    const dir = folder();
    writeFileSync(path.join(dir, "installation.json"), "{ rotto");
    expect((await loadInstallation(dir)).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("controllo automatico degli aggiornamenti: attivo di base, si spegne e resta spento", async () => {
    const dir = folder();
    expect(await loadPreferences(dir)).toEqual({ autoCheckUpdates: true, welcomeSeen: false });
    await savePreferences(dir, { autoCheckUpdates: false, welcomeSeen: true });
    expect(await loadPreferences(dir)).toEqual({ autoCheckUpdates: false, welcomeSeen: true });
  });
});

class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = false;
  autoInstallOnAppQuit = true;
  checks = 0;
  installed = 0;
  checkForUpdates(): Promise<unknown> {
    this.checks++;
    this.emit("checking-for-update");
    return Promise.resolve(undefined);
  }
  quitAndInstall(): void {
    this.installed++;
  }
}

function setup(autoCheck = true) {
  const updater = new FakeUpdater();
  const states: UpdateState[] = [];
  const updates = new Updates({
    updater,
    autoCheck,
    onChange: (state) => states.push(state),
    log: () => undefined,
  });
  return { updater, states, updates };
}

describe("aggiornamenti", () => {
  it("scarica da solo ma non installa mai da solo", () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("controllo, download, pronto: si installa solo quando e' pronto", async () => {
    const { updater, updates, states } = setup();
    expect(updates.install()).toBe(false);
    await updates.check();
    expect(updates.state).toEqual({ status: "checking" });
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("download-progress", { percent: 41.6 });
    expect(updates.state).toEqual({ status: "downloading", version: "0.2.0", percent: 42 });
    expect(updates.install()).toBe(false);
    updater.emit("update-downloaded", { version: "0.2.0" });
    expect(updates.state).toEqual({ status: "ready", version: "0.2.0" });
    // Un errore dopo non toglie l'aggiornamento pronto.
    updater.emit("error", new Error("offline"));
    expect(updates.state.status).toBe("ready");
    expect(updates.install()).toBe(true);
    expect(updater.installed).toBe(1);
    expect(states.map((s) => s.status)).toEqual([
      "checking",
      "downloading",
      "downloading",
      "ready",
    ]);
  });

  it("nessuna novita' o errore di rete: si dice, senza fermare nulla", async () => {
    const { updater, updates } = setup();
    await updates.check();
    updater.emit("update-not-available");
    expect(updates.state.status).toBe("upToDate");
    await updates.check();
    updater.emit("error", new Error("offline"));
    expect(updates.state.status).toBe("error");
  });

  it("controlli automatici solo se attivi", () => {
    vi.useFakeTimers();
    try {
      const on = setup(true);
      on.updates.start();
      vi.advanceTimersByTime(FIRST_CHECK_MS + 1);
      expect(on.updater.checks).toBe(1);

      const off = setup(false);
      off.updates.start();
      vi.advanceTimersByTime(FIRST_CHECK_MS * 10);
      expect(off.updater.checks).toBe(0);
      off.updates.setAutoCheck(true);
      vi.advanceTimersByTime(FIRST_CHECK_MS + 1);
      expect(off.updater.checks).toBe(1);
      on.updates.stop();
      off.updates.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("versione di sviluppo: niente aggiornamenti", async () => {
    const updates = new Updates({
      updater: undefined,
      autoCheck: true,
      onChange: () => undefined,
      log: () => undefined,
    });
    await updates.check();
    expect(updates.state).toEqual({ status: "unsupported" });
    expect(updates.install()).toBe(false);
  });
});

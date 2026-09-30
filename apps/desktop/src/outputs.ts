import type { Engine, Logger } from "@cuelith-core/engine";
import { DisplayTargetSchema, type DisplayTarget } from "@cuelith/protocol";
import { BrowserWindow, screen, type Display } from "electron";

interface Placed {
  readonly window: BrowserWindow;
  readonly target: DisplayTarget;
}

export interface OutputWindowsOptions {
  readonly engine: Engine;
  readonly origin: string;
  readonly logger: Logger;
  /** Crea la finestra con le preferenze sicure comuni e la registra come "output". */
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow;
}

const WINDOW_SIZE = { width: 960, height: 540 };
const RELOAD_AFTER_CRASH_MS = 500;

/**
 * Tiene una finestra aperta per ogni uscita "display" dello show, sul monitor
 * scelto: la apre, la sposta, la chiude quando l'uscita cambia o sparisce.
 * Se il monitor non c'e' (scollegato) l'uscita va in errore e la postazione
 * lo mostra; quando torna, la finestra si riapre da sola.
 */
export class OutputWindows {
  readonly #options: OutputWindowsOptions;
  readonly #placed = new Map<string, Placed>();
  #scheduled = false;
  #stopped = false;
  #unsubscribe: (() => void) | undefined;

  constructor(options: OutputWindowsOptions) {
    this.#options = options;
  }

  start(): void {
    const { engine } = this.#options;
    this.#unsubscribe = engine.context.store.onPatch((_rev, ops) => {
      if (ops.some((op) => op.path.startsWith("/show/outputs"))) this.#schedule();
    });
    screen.on("display-added", this.#schedule);
    screen.on("display-removed", this.#schedule);
    screen.on("display-metrics-changed", this.#schedule);
    this.#reconcile();
  }

  stop(): void {
    this.#stopped = true;
    this.#unsubscribe?.();
    screen.off("display-added", this.#schedule);
    screen.off("display-removed", this.#schedule);
    screen.off("display-metrics-changed", this.#schedule);
    for (const id of [...this.#placed.keys()]) this.#close(id);
  }

  // Mai dentro un ascoltatore delle patch: le modifiche di stato fatte qui
  // produrrebbero patch annidate e fuori ordine.
  readonly #schedule = (): void => {
    if (this.#scheduled || this.#stopped) return;
    this.#scheduled = true;
    setImmediate(() => {
      this.#scheduled = false;
      if (!this.#stopped) this.#reconcile();
    });
  };

  #reconcile(): void {
    const { engine } = this.#options;
    const wanted = engine.context.store.read((doc) =>
      Object.values(doc.show.outputs)
        .filter((o) => o.kind === "display" && o.provider === "core")
        .map((o) => ({ id: o.id, name: o.name, target: DisplayTargetSchema.safeParse(o.target) })),
    );
    const ids = new Set(wanted.map((o) => o.id));
    for (const id of [...this.#placed.keys()]) if (!ids.has(id)) this.#close(id);

    const displays = screen.getAllDisplays();
    for (const output of wanted) {
      if (!output.target.success) continue;
      const target = output.target.data;
      const display = displays.find((d) => String(d.id) === target.displayId);
      if (display === undefined) {
        this.#close(output.id);
        engine.setOutputStatus(output.id, "error", "core.output.displayMissing");
        continue;
      }
      const placed = this.#placed.get(output.id);
      if (
        placed !== undefined &&
        placed.target.displayId === target.displayId &&
        placed.target.mode === target.mode
      ) {
        placed.window.setTitle(output.name);
        if (target.mode === "fullscreen") placed.window.setBounds(display.bounds);
        continue;
      }
      this.#close(output.id);
      this.#open(output.id, output.name, target, display);
    }
  }

  #open(id: string, name: string, target: DisplayTarget, display: Display): void {
    const { engine, origin, logger, createWindow } = this.#options;
    const fullscreen = target.mode === "fullscreen";
    const bounds = fullscreen
      ? display.bounds
      : {
          ...WINDOW_SIZE,
          x: Math.round(display.workArea.x + (display.workArea.width - WINDOW_SIZE.width) / 2),
          y: Math.round(display.workArea.y + (display.workArea.height - WINDOW_SIZE.height) / 2),
        };
    const window = createWindow({
      title: name,
      ...bounds,
      show: false,
      frame: !fullscreen,
      fullscreen,
      // Un'uscita si toglie dalla postazione, non chiudendo la finestra.
      closable: false,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
    });
    window.once("ready-to-show", () => {
      // Senza rubare il fuoco alla postazione: i tasti della regia restano li'.
      window.showInactive();
    });
    window.webContents.on("did-finish-load", () => {
      engine.setOutputStatus(id, "ok");
    });
    window.webContents.on("render-process-gone", (_event, details) => {
      logger.error(`uscita ${name}: processo di disegno terminato (${details.reason})`);
      engine.setOutputStatus(id, "error", "core.output.crashed");
      setTimeout(() => {
        if (!window.isDestroyed()) window.webContents.reload();
      }, RELOAD_AFTER_CRASH_MS);
    });
    void window.loadURL(`${origin}/renderer/?output=${encodeURIComponent(id)}`);
    this.#placed.set(id, { window, target });
  }

  #close(id: string): void {
    const placed = this.#placed.get(id);
    if (placed === undefined) return;
    this.#placed.delete(id);
    if (!placed.window.isDestroyed()) placed.window.destroy();
  }
}

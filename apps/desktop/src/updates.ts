// Aggiornamenti dell'app (decisione 0004): controllo delle nuove versioni su
// GitHub Releases e download in background; l'installazione la decide sempre
// l'operatore, mai durante una diretta.

/** Stato degli aggiornamenti mostrato nella postazione (Impostazioni → Informazioni). */
export type UpdateState =
  /** Versione di sviluppo (non installata): gli aggiornamenti non si applicano. */
  | { readonly status: "unsupported" }
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "upToDate"; readonly checkedAt: string }
  | { readonly status: "downloading"; readonly version: string; readonly percent: number }
  | { readonly status: "ready"; readonly version: string }
  | { readonly status: "error"; readonly checkedAt: string };

/** La parte di electron-updater che serve qui (sostituibile nelle prove). */
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "checking-for-update" | "update-not-available", listener: () => void): unknown;
  on(
    event: "update-available" | "update-downloaded",
    listener: (info: { version: string }) => void,
  ): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

/** Primo controllo poco dopo l'avvio, poi ogni 6 ore (se attivo). */
export const FIRST_CHECK_MS = 30_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface UpdatesOptions {
  /** undefined = versione di sviluppo: nessun controllo. */
  readonly updater: Updater | undefined;
  readonly autoCheck: boolean;
  readonly onChange: (state: UpdateState) => void;
  readonly log: (message: string, error?: unknown) => void;
}

export class Updates {
  readonly #updater: Updater | undefined;
  readonly #onChange: (state: UpdateState) => void;
  readonly #log: (message: string, error?: unknown) => void;
  #state: UpdateState;
  #timer: NodeJS.Timeout | undefined;
  #autoCheck: boolean;

  constructor(options: UpdatesOptions) {
    this.#updater = options.updater;
    this.#onChange = options.onChange;
    this.#log = options.log;
    this.#autoCheck = options.autoCheck;
    this.#state = options.updater === undefined ? { status: "unsupported" } : { status: "idle" };
    const updater = options.updater;
    if (updater === undefined) return;

    // Scarica da solo, ma non installa mai da solo (neanche alla chiusura).
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => {
      if (this.#state.status !== "ready") this.#set({ status: "checking" });
    });
    updater.on("update-not-available", () => {
      this.#set({ status: "upToDate", checkedAt: new Date().toISOString() });
    });
    updater.on("update-available", (info) => {
      this.#set({ status: "downloading", version: info.version, percent: 0 });
    });
    updater.on("download-progress", (progress) => {
      if (this.#state.status !== "downloading") return;
      this.#set({ ...this.#state, percent: Math.round(progress.percent) });
    });
    updater.on("update-downloaded", (info) => {
      this.#set({ status: "ready", version: info.version });
    });
    updater.on("error", (error) => {
      this.#log("controllo degli aggiornamenti non riuscito", error);
      // Un aggiornamento gia' scaricato resta pronto anche se un controllo dopo fallisce.
      if (this.#state.status !== "ready")
        this.#set({ status: "error", checkedAt: new Date().toISOString() });
    });
  }

  get state(): UpdateState {
    return this.#state;
  }

  get autoCheck(): boolean {
    return this.#autoCheck;
  }

  #set(state: UpdateState): void {
    this.#state = state;
    this.#onChange(state);
  }

  /** Avvia i controlli automatici (se attivi). */
  start(): void {
    this.#schedule(FIRST_CHECK_MS);
  }

  #schedule(delay: number): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#updater === undefined || !this.#autoCheck) return;
    this.#timer = setTimeout(() => {
      void this.check();
      this.#schedule(CHECK_EVERY_MS);
    }, delay);
    this.#timer.unref();
  }

  setAutoCheck(on: boolean): void {
    this.#autoCheck = on;
    this.#schedule(on ? FIRST_CHECK_MS : 0);
  }

  /** Controllo adesso (chiesto dall'operatore o dal timer). */
  async check(): Promise<void> {
    const updater = this.#updater;
    if (updater === undefined) return;
    if (this.#state.status === "checking" || this.#state.status === "downloading") return;
    if (this.#state.status === "ready") return;
    try {
      await updater.checkForUpdates();
    } catch (error) {
      // Gia' segnalato dall'evento "error"; qui basta non far cadere nulla.
      this.#log("controllo degli aggiornamenti non riuscito", error);
      // Lo stato puo' essere cambiato durante l'attesa (eventi dell'updater).
      if (this.state.status === "checking")
        this.#set({ status: "error", checkedAt: new Date().toISOString() });
    }
  }

  /** Installa e riavvia: solo con un aggiornamento pronto (le altre condizioni le controlla chi chiama). */
  install(): boolean {
    if (this.#updater === undefined || this.#state.status !== "ready") return false;
    this.#updater.quitAndInstall(false, true);
    return true;
  }

  stop(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

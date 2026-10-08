import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import {
  summarizeResources,
  type OutputFrames,
  type ResourcePart,
  type ResourceReport,
  type ResourceUsage,
} from "@cuelith/protocol";
import type { Logger } from "./log.js";
import type { ModuleRegistry } from "./modules/registry.js";
import type { ModuleSupervisor } from "./modules/supervisor.js";
import type { StateStore } from "./state/store.js";

/** Una misura di una parte della piattaforma (motore, postazione, uscita, scheda video...). */
export interface PlatformPart {
  readonly id: string;
  readonly kind: "engine" | "station" | "output" | "gpu" | "other";
  readonly current: ResourceUsage;
}

/** Contatori cumulativi dei fotogrammi di un'uscita (dalla finestra che la disegna). */
export interface OutputCounters {
  readonly outputId: string;
  readonly frames: number;
  readonly lateFrames: number;
}

/**
 * Chi misura la piattaforma: il desktop con le metriche di Electron (tutti i
 * suoi processi), le prove col solo processo del motore.
 */
export interface MetricsProvider {
  sample(): Promise<{
    readonly parts: readonly PlatformPart[];
    readonly outputs: readonly OutputCounters[];
    readonly gpu?: string;
  }>;
}

/** Solo il processo del motore (Node puro, senza Electron). */
export function processMetrics(): MetricsProvider {
  let last = process.cpuUsage();
  let lastAt = performance.now();
  return {
    sample: () => {
      const now = performance.now();
      const cpu = process.cpuUsage(last);
      const elapsed = Math.max(1, now - lastAt);
      last = process.cpuUsage();
      lastAt = now;
      return Promise.resolve({
        parts: [
          {
            id: "core.engine",
            kind: "engine",
            current: {
              memoryMB: process.memoryUsage.rss() / (1024 * 1024),
              cpuPercent: ((cpu.user + cpu.system) / 1000 / elapsed) * 100,
            },
          },
        ],
        outputs: [],
      });
    },
  };
}

const PEAKS_SAVE_MS = 60_000;

/**
 * Freno della memoria: sotto questa quantita' libera (il maggiore tra il minimo in MB e la frazione
 * della memoria totale) si ferma il plugin piu' pesante, se pesa almeno `minPluginMB`. Meglio un
 * plugin fermo, con la sua spiegazione, che un computer senza memoria in mezzo a una diretta.
 */
export const MEMORY_GUARD = { minFreeMB: 400, minFreeFraction: 0.04, minPluginMB: 150 } as const;

export interface ResourceMonitorOptions {
  readonly provider: MetricsProvider;
  readonly registry: ModuleRegistry;
  readonly supervisor: ModuleSupervisor;
  readonly store: StateStore;
  /** File dove restano i massimi osservati tra un avvio e l'altro. */
  readonly peaksFile: string;
  readonly logger: Logger;
  /** Ogni quanto si misura in background (i massimi non si perdono). */
  readonly intervalMs?: number;
  /** Memoria del computer (le prove la decidono; di norma e' quella vera). */
  readonly memory?: () => { totalMB: number; freeMB: number };
}

/**
 * Contatore delle risorse (dal protocollo 1.9): piattaforma + moduli attivi
 * rispetto al computer. Misura ogni 10 secondi (costa pochissimo: le metriche
 * dei processi e il consumo che i moduli mandano col controllo periodico) e
 * ricorda minimi e massimi; i massimi restano su disco.
 */
const defaultMemory = () => ({
  totalMB: os.totalmem() / (1024 * 1024),
  freeMB: os.freemem() / (1024 * 1024),
});

export class ResourceMonitor {
  readonly #options: ResourceMonitorOptions;
  readonly #low = new Map<string, ResourceUsage>();
  #peaks = new Map<string, ResourceUsage>();
  #lastCounters = new Map<string, { frames: number; lateFrames: number; at: number }>();
  #outputs: OutputFrames[] = [];
  #platform: readonly PlatformPart[] = [];
  #gpu: string | undefined;
  #sampledAt = 0;
  #timer: NodeJS.Timeout | undefined;
  #peaksDirty = false;
  #peaksSavedAt = 0;
  #sampling: Promise<void> | undefined;

  constructor(options: ResourceMonitorOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.#options.peaksFile, "utf8")) as {
        peaks?: Record<string, ResourceUsage>;
      };
      for (const [id, usage] of Object.entries(raw.peaks ?? {})) {
        if (typeof usage.memoryMB === "number" && typeof usage.cpuPercent === "number")
          this.#peaks.set(id, { memoryMB: usage.memoryMB, cpuPercent: usage.cpuPercent });
      }
    } catch {
      // Primo avvio o file rovinato: si riparte senza massimi.
    }
    await this.#sample();
    this.#timer = setInterval(() => {
      void this.#sample();
    }, this.#options.intervalMs ?? 10_000);
    this.#timer.unref();
  }

  async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#savePeaks(true);
  }

  /** Il quadro attuale; se l'ultima misura ha piu' di 2 secondi, se ne fa una nuova. */
  async report(): Promise<ResourceReport> {
    if (Date.now() - this.#sampledAt > 2000) await this.#sample();
    return this.#build();
  }

  #sample(): Promise<void> {
    this.#sampling ??= (async () => {
      try {
        const sample = await this.#options.provider.sample();
        const now = Date.now();
        this.#platform = sample.parts;
        if (sample.gpu !== undefined) this.#gpu = sample.gpu;
        // Fotogrammi al secondo e in ritardo dall'ultima misura.
        const counters = new Map<string, { frames: number; lateFrames: number; at: number }>();
        this.#outputs = sample.outputs.map((o) => {
          const before = this.#lastCounters.get(o.outputId);
          counters.set(o.outputId, { frames: o.frames, lateFrames: o.lateFrames, at: now });
          if (before === undefined || o.frames < before.frames) {
            return { outputId: o.outputId, fps: 0, lateFrames: 0 };
          }
          const seconds = Math.max(0.001, (now - before.at) / 1000);
          return {
            outputId: o.outputId,
            fps: Math.round((o.frames - before.frames) / seconds),
            lateFrames: Math.max(0, o.lateFrames - before.lateFrames),
          };
        });
        this.#lastCounters = counters;
        for (const part of this.#parts()) {
          if (part.current !== undefined) this.#track(part.id, part.current);
        }
        this.#sampledAt = now;
        this.#guardMemory();
        await this.#savePeaks(false);
      } catch (error) {
        this.#options.logger.warn("misura delle risorse non riuscita", error);
      } finally {
        this.#sampling = undefined;
      }
    })();
    return this.#sampling;
  }

  /** Se la memoria libera e' sotto la soglia, ferma il plugin piu' pesante (uno per misura). */
  #guardMemory(): void {
    const { totalMB, freeMB } = (this.#options.memory ?? defaultMemory)();
    if (freeMB >= Math.max(MEMORY_GUARD.minFreeMB, totalMB * MEMORY_GUARD.minFreeFraction)) return;
    const heaviest = this.#options.supervisor
      .usages()
      .filter(
        (entry) => entry.usage !== undefined && entry.usage.memoryMB >= MEMORY_GUARD.minPluginMB,
      )
      .sort((a, b) => (b.usage?.memoryMB ?? 0) - (a.usage?.memoryMB ?? 0))[0];
    if (heaviest !== undefined) this.#options.supervisor.stopForLowMemory(heaviest.id);
  }

  #track(id: string, usage: ResourceUsage): void {
    const low = this.#low.get(id);
    this.#low.set(
      id,
      low === undefined
        ? usage
        : {
            memoryMB: Math.min(low.memoryMB, usage.memoryMB),
            cpuPercent: Math.min(low.cpuPercent, usage.cpuPercent),
          },
    );
    const peak = this.#peaks.get(id);
    if (
      peak === undefined ||
      usage.memoryMB > peak.memoryMB ||
      usage.cpuPercent > peak.cpuPercent
    ) {
      this.#peaks.set(id, {
        memoryMB: Math.max(peak?.memoryMB ?? 0, usage.memoryMB),
        cpuPercent: Math.max(peak?.cpuPercent ?? 0, usage.cpuPercent),
      });
      this.#peaksDirty = true;
    }
  }

  async #savePeaks(force: boolean): Promise<void> {
    if (!this.#peaksDirty) return;
    if (!force && Date.now() - this.#peaksSavedAt < PEAKS_SAVE_MS) return;
    this.#peaksDirty = false;
    this.#peaksSavedAt = Date.now();
    try {
      await mkdir(dirname(this.#options.peaksFile), { recursive: true });
      await writeFile(
        this.#options.peaksFile,
        `${JSON.stringify({ schema: 1, peaks: Object.fromEntries(this.#peaks) }, null, 2)}\n`,
      );
    } catch (error) {
      this.#options.logger.warn("massimi delle risorse non salvati", error);
    }
  }

  /** Piattaforma (misurata) e moduli attivi (riportati e dichiarati), con i nomi. */
  #parts(): ResourcePart[] {
    const round = (u: ResourceUsage): ResourceUsage => ({
      memoryMB: Math.round(u.memoryMB),
      cpuPercent: Math.round(u.cpuPercent * 10) / 10,
    });
    const outputs = this.#options.store.read((doc) => doc.show.outputs);
    const platform: ResourcePart[] = this.#platform.map((part) => {
      const outputId = part.kind === "output" ? part.id.slice("core.output:".length) : undefined;
      const name = outputId === undefined ? undefined : outputs[outputId]?.name;
      return {
        id: part.id,
        kind: part.kind,
        ...(name === undefined ? {} : { name }),
        current: round(part.current),
      };
    });
    const modules: ResourcePart[] = this.#options.supervisor.usages().map(({ id, usage }) => {
      const manifest = this.#options.registry.find(id)?.manifest;
      return {
        id,
        kind: "module",
        ...(manifest === undefined ? {} : { name: manifest.name }),
        ...(usage === undefined ? {} : { current: round(usage) }),
        ...(manifest?.resources === undefined ? {} : { declared: manifest.resources }),
      };
    });
    return [...platform, ...modules];
  }

  #build(): ResourceReport {
    const parts = this.#parts().map((part) => {
      const low = this.#low.get(part.id);
      const peak = this.#peaks.get(part.id);
      return {
        ...part,
        ...(low === undefined ? {} : { low }),
        ...(peak === undefined ? {} : { peak }),
      };
    });
    const cpus = os.cpus();
    const system = {
      cpuModel: cpus[0]?.model.trim() ?? "",
      cpuCores: Math.max(1, cpus.length),
      memoryTotalMB: Math.round(os.totalmem() / (1024 * 1024)),
      memoryFreeMB: Math.round(os.freemem() / (1024 * 1024)),
      ...(this.#gpu === undefined ? {} : { gpu: this.#gpu }),
    };
    return {
      sampledAt: new Date(this.#sampledAt).toISOString(),
      system,
      parts,
      outputs: this.#outputs,
      ...summarizeResources(parts, system, this.#outputs),
    };
  }
}

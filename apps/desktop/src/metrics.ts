import type { MetricsProvider, OutputCounters, PlatformPart } from "@cuelith-core/engine";
import { app } from "electron";

export interface MetricsSources {
  /** Processo della postazione locale, se aperta. */
  readonly stationPid: () => number | undefined;
  /** Processi delle finestre di uscita. */
  readonly outputs: () => readonly { outputId: string; pid: number }[];
  readonly frameCounters: () => Promise<readonly OutputCounters[]>;
}

/** Nome della scheda video attiva, se il sistema lo dice. */
async function gpuName(): Promise<string | undefined> {
  try {
    const info = (await app.getGPUInfo("basic")) as {
      gpuDevice?: { active?: boolean; deviceString?: string }[];
    };
    const devices = info.gpuDevice ?? [];
    const active = devices.find((d) => d.active === true) ?? devices[0];
    const name = active?.deviceString?.trim();
    return name === undefined || name === "" ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * Misure della piattaforma con le metriche di Electron (contatore delle
 * risorse): processo principale (motore), scheda video, postazione, ogni
 * uscita; tutto il resto (servizi di Chromium, pannelli e finestre degli
 * editor dei moduli) va in "altro". I processi dei moduli non ci sono: il
 * loro consumo lo riportano loro al motore.
 */
export function electronMetrics(sources: MetricsSources): MetricsProvider {
  let gpu: Promise<string | undefined> | undefined;
  return {
    sample: async () => {
      gpu ??= gpuName();
      const roles = new Map<number, Pick<PlatformPart, "id" | "kind">>();
      const station = sources.stationPid();
      if (station !== undefined && station > 0)
        roles.set(station, { id: "core.station", kind: "station" });
      for (const { outputId, pid } of sources.outputs()) {
        if (pid > 0) roles.set(pid, { id: `core.output:${outputId}`, kind: "output" });
      }
      const parts = new Map<
        string,
        { id: string; kind: PlatformPart["kind"]; memoryMB: number; cpuPercent: number }
      >();
      for (const metric of app.getAppMetrics()) {
        const role =
          metric.type === "Browser"
            ? { id: "core.engine", kind: "engine" as const }
            : metric.type === "GPU"
              ? { id: "core.gpu", kind: "gpu" as const }
              : (roles.get(metric.pid) ?? { id: "core.other", kind: "other" as const });
        const part = parts.get(role.id) ?? { ...role, memoryMB: 0, cpuPercent: 0 };
        // workingSetSize e' in KB.
        part.memoryMB += metric.memory.workingSetSize / 1024;
        part.cpuPercent += metric.cpu.percentCPUUsage;
        parts.set(role.id, part);
      }
      const [counters, name] = await Promise.all([sources.frameCounters(), gpu]);
      return {
        parts: [...parts.values()].map(({ id, kind, memoryMB, cpuPercent }) => ({
          id,
          kind,
          current: { memoryMB, cpuPercent },
        })),
        outputs: counters,
        ...(name === undefined ? {} : { gpu: name }),
      };
    },
  };
}

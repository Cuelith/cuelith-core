import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceUsage } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { silentLogger } from "../src/log.js";
import type { ModuleRegistry } from "../src/modules/registry.js";
import type { ModuleSupervisor } from "../src/modules/supervisor.js";
import {
  processMetrics,
  ResourceMonitor,
  type MetricsProvider,
  type OutputCounters,
  type PlatformPart,
} from "../src/resources.js";
import type { StateStore } from "../src/state/store.js";

const usage = (memoryMB: number, cpuPercent: number): ResourceUsage => ({ memoryMB, cpuPercent });

/** Misure decise dalla prova, una dopo l'altra. */
function scripted(
  steps: { parts: PlatformPart[]; outputs?: OutputCounters[] }[],
): MetricsProvider & { next: () => void } {
  let index = 0;
  return {
    next: () => {
      index = Math.min(index + 1, steps.length - 1);
    },
    sample: () => {
      const step = steps[index] ?? { parts: [] };
      return Promise.resolve({ parts: step.parts, outputs: step.outputs ?? [], gpu: "Prova GPU" });
    },
  };
}

const store = {
  read: <T>(fn: (doc: never) => T) =>
    fn({ show: { outputs: { o1: { name: "Proiettore" } } } } as never),
} as unknown as StateStore;

function monitor(
  provider: MetricsProvider,
  peaksFile: string,
  modules: { id: string; usage: ResourceUsage | undefined }[] = [],
) {
  const supervisor = { usages: () => modules } as unknown as ModuleSupervisor;
  const registry = {
    find: (id: string) =>
      id === "cuelith.ndi"
        ? {
            manifest: {
              name: "NDI",
              resources: {
                memoryMB: { idle: 100, peak: 600 },
                cpuPercent: { idle: 5, peak: 150 },
              },
            },
          }
        : undefined,
  } as unknown as ModuleRegistry;
  return new ResourceMonitor({
    provider,
    registry,
    supervisor,
    store,
    peaksFile,
    logger: silentLogger,
    intervalMs: 60_000,
  });
}

describe("contatore delle risorse", () => {
  it("piattaforma e moduli, con nomi, minimi, massimi e consumo dichiarato", async () => {
    const provider = scripted([
      {
        parts: [
          { id: "core.engine", kind: "engine", current: usage(300, 4) },
          { id: "core.output:o1", kind: "output", current: usage(120, 8) },
        ],
      },
      {
        parts: [
          { id: "core.engine", kind: "engine", current: usage(350, 20) },
          { id: "core.output:o1", kind: "output", current: usage(110, 6) },
        ],
      },
    ]);
    const peaks = join(mkdtempSync(join(tmpdir(), "cuelith-res-")), "resources.json");
    const m = monitor(provider, peaks, [{ id: "cuelith.ndi", usage: usage(90, 3) }]);
    await m.start();
    provider.next();
    await new Promise((r) => setTimeout(r, 2100));
    const report = await m.report();
    await m.stop();

    const engine = report.parts.find((p) => p.id === "core.engine");
    expect(engine).toMatchObject({
      current: usage(350, 20),
      low: usage(300, 4),
      peak: usage(350, 20),
    });
    expect(report.parts.find((p) => p.kind === "output")?.name).toBe("Proiettore");
    const ndi = report.parts.find((p) => p.id === "cuelith.ndi");
    expect(ndi).toMatchObject({ kind: "module", name: "NDI", current: usage(90, 3) });
    expect(report.system.gpu).toBe("Prova GPU");
    // Massimo: il piu' alto tra dichiarato (600 MB, 150%) e osservato.
    expect(report.totals.max.memoryMB).toBe(350 + 120 + 600);
    expect(report.totals.current.memoryMB).toBe(350 + 110 + 90);

    // I massimi restano dopo un riavvio.
    const again = monitor(
      scripted([{ parts: [{ id: "core.engine", kind: "engine", current: usage(200, 1) }] }]),
      peaks,
    );
    await again.start();
    const after = await again.report();
    await again.stop();
    expect(after.parts.find((p) => p.id === "core.engine")?.peak).toEqual(usage(350, 20));
  });

  it("fotogrammi al secondo e in ritardo dall'ultima misura", async () => {
    const provider = scripted([
      { parts: [], outputs: [{ outputId: "o1", frames: 100, lateFrames: 0 }] },
      { parts: [], outputs: [{ outputId: "o1", frames: 226, lateFrames: 4 }] },
    ]);
    const m = monitor(provider, join(mkdtempSync(join(tmpdir(), "cuelith-res-")), "r.json"));
    await m.start();
    provider.next();
    await new Promise((r) => setTimeout(r, 2100));
    const report = await m.report();
    await m.stop();
    const frames = report.outputs[0];
    expect(frames?.lateFrames).toBe(4);
    expect(frames?.fps).toBeGreaterThan(40);
    expect(frames?.fps).toBeLessThan(70);
    expect(report.level).toBe("danger");
    expect(report.reasons).toContain("core.resources.reason.lateFrames");
  });

  it("senza Electron misura il processo del motore", async () => {
    const sample = await processMetrics().sample();
    expect(sample.parts[0]?.id).toBe("core.engine");
    expect(sample.parts[0]?.current.memoryMB).toBeGreaterThan(10);
  });
});

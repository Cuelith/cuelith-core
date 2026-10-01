import type { ResourceLevel, ResourcePart, ResourceReport } from "@cuelith/protocol";
import { useEffect, useState } from "react";
import { useConnection, useEngine, useT } from "../engine/react.js";

// Contatore delle risorse (protocollo 1.9): quanto usano piattaforma e moduli
// attivi rispetto al computer, per sapere prima se il PC reggera' il lavoro.

/** Ultimo quadro delle risorse, chiesto al motore ogni `intervalMs`. */
export function useResources(intervalMs: number): ResourceReport | undefined {
  const connection = useConnection();
  const connected = useEngine().status.kind === "connected";
  const [report, setReport] = useState<ResourceReport | undefined>();
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const load = () => {
      connection.call("system.resources", {}).then(
        (next) => {
          if (alive) setReport(next);
        },
        () => undefined,
      );
    };
    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [connection, connected, intervalMs]);
  return report;
}

const LEVEL_COLOR: Record<ResourceLevel, string> = {
  ok: "bg-cue",
  warning: "bg-stage",
  danger: "bg-live",
};

/** Memoria leggibile: MB sotto il giga, GB sopra (con la lingua attiva). */
function formatMemory(mb: number, lang: string): string {
  if (mb < 1024) return `${new Intl.NumberFormat(lang).format(Math.round(mb))} MB`;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(mb / 1024)} GB`;
}

/** CPU in percentuale dell'intero computer (non di un core). */
function formatCpu(percentOfCore: number, cores: number, lang: string): string {
  const share = percentOfCore / (cores * 100);
  // Sotto l'1% un decimale: "0%" direbbe che non lavora affatto.
  return new Intl.NumberFormat(lang, {
    style: "percent",
    maximumFractionDigits: share < 0.01 ? 1 : 0,
  }).format(share);
}

/** Indicatore nella barra in alto: un colore, il dettaglio nelle Impostazioni. */
export function ResourcesIndicator({ onOpen }: { onOpen: () => void }) {
  const t = useT();
  const report = useResources(15_000);
  if (report === undefined) return null;
  const label = t(`core.resources.level.${report.level}`);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("core.resources.indicator", { level: label })}
      title={t("core.resources.indicator", { level: label })}
      data-level={report.level}
      className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-bg-3 hover:text-fg"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${LEVEL_COLOR[report.level]}`} />
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
      </svg>
    </button>
  );
}

/**
 * Barra: capacita' del computer; tacca = a riposo, pieno = adesso, contorno =
 * massimo stimato (il piu' alto tra dichiarato dai moduli e osservato).
 */
function Meter({
  label,
  min,
  current,
  max,
  capacity,
  format,
}: {
  label: string;
  min: number;
  current: number;
  max: number;
  capacity: number;
  format: (value: number) => string;
}) {
  const t = useT();
  const pct = (value: number) => `${String(Math.min(100, (value / capacity) * 100))}%`;
  const tone =
    max > capacity * 0.9 ? "border-live" : max > capacity * 0.7 ? "border-stage" : "border-cue";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-xs text-muted tabular-nums">
          {t("core.resources.meter", {
            min: format(min),
            current: format(current),
            max: format(max),
            capacity: format(capacity),
          })}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={current}
        className="relative h-3 overflow-hidden rounded-full bg-bg-3"
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full border ${tone}`}
          style={{ width: pct(max) }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-cue/70"
          style={{ width: pct(current) }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-fg/70" style={{ left: pct(min) }} />
      </div>
    </div>
  );
}

function partName(part: ResourcePart, t: (key: string, params?: Record<string, string>) => string) {
  switch (part.kind) {
    case "output":
      return t("core.resources.part.output", { name: part.name ?? "" });
    case "module":
      return part.name ?? part.id;
    default:
      return t(`core.resources.part.${part.kind}`);
  }
}

/** Sezione Risorse delle Impostazioni: semaforo, barre, dettaglio per parte e per uscita. */
export function ResourcesSection() {
  const t = useT();
  const { lang } = useEngine();
  const report = useResources(2000);
  if (report === undefined)
    return <p className="text-sm text-muted">{t("core.resources.loading")}</p>;
  const { system, totals } = report;
  const memory = (mb: number) => formatMemory(mb, lang);
  const cpu = (value: number) => formatCpu(value, system.cpuCores, lang);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2" role="status">
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${LEVEL_COLOR[report.level]}`}
        />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold">{t(`core.resources.summary.${report.level}`)}</p>
          {report.reasons.map((reason) => (
            <p key={reason} className="text-xs text-muted">
              {t(reason)}
            </p>
          ))}
        </div>
      </div>
      <Meter
        label={t("core.resources.memory")}
        min={totals.min.memoryMB}
        current={totals.current.memoryMB}
        max={totals.max.memoryMB}
        capacity={system.memoryTotalMB}
        format={memory}
      />
      <Meter
        label={t("core.resources.cpu")}
        min={totals.min.cpuPercent}
        current={totals.current.cpuPercent}
        max={totals.max.cpuPercent}
        capacity={system.cpuCores * 100}
        format={cpu}
      />
      <p className="text-xs text-muted">
        {t("core.resources.system", {
          cpu: system.cpuModel,
          cores: String(system.cpuCores),
          memory: memory(system.memoryTotalMB),
          free: memory(system.memoryFreeMB),
        })}
        {system.gpu === undefined ? "" : ` · ${system.gpu}`}
      </p>

      {report.outputs.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t("core.resources.outputs")}>
          {report.outputs.map((o) => {
            const part = report.parts.find((p) => p.id === `core.output:${o.outputId}`);
            return (
              <li key={o.outputId} className="flex justify-between gap-3 text-sm">
                <span className="truncate">{part?.name ?? o.outputId}</span>
                <span className={`tabular-nums ${o.lateFrames > 0 ? "text-stage" : "text-muted"}`}>
                  {t("core.resources.frames", {
                    fps: String(o.fps),
                    late: String(o.lateFrames),
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <caption className="sr-only">{t("core.resources.parts")}</caption>
          <thead className="text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("core.resources.col.part")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("core.resources.col.now")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("core.resources.col.peak")}</th>
              <th className="py-1 text-right font-medium">{t("core.resources.col.declared")}</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {report.parts.map((part) => (
              <tr key={part.id} className="border-t border-line">
                <td className="py-1 pr-3">{partName(part, t)}</td>
                <td className="py-1 pr-3 text-right">
                  {part.current === undefined
                    ? "—"
                    : `${memory(part.current.memoryMB)} · ${cpu(part.current.cpuPercent)}`}
                </td>
                <td className="py-1 pr-3 text-right">
                  {part.peak === undefined
                    ? "—"
                    : `${memory(part.peak.memoryMB)} · ${cpu(part.peak.cpuPercent)}`}
                </td>
                <td className="py-1 text-right">
                  {part.declared === undefined
                    ? "—"
                    : `${memory(part.declared.memoryMB.peak)} · ${cpu(part.declared.cpuPercent.peak)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-prose text-xs text-muted">{t("core.resources.legend")}</p>
    </div>
  );
}

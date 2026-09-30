import { useEngine, useT } from "../engine/react.js";
import type { Mode } from "../modes/core.js";
import type { ShowFiles } from "../station/files.js";
import { useRun } from "../station/station.js";
import { Button } from "../ui/Button.js";
import { ShowMenu } from "./ShowMenu.js";

/** Marchio: quadrato ciano (prossimo) con il punto rosso (in onda). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-lg border-[1.5px] border-cue"
      style={{ width: size, height: size }}
    >
      <span className="rounded-full bg-live" style={{ width: size * 0.36, height: size * 0.36 }} />
    </span>
  );
}

export function TopBar({
  modes,
  active,
  onSelect,
  onManageOutputs,
  files,
}: {
  modes: readonly Mode[];
  active: Mode;
  onSelect: (mode: Mode) => void;
  onManageOutputs: () => void;
  files: ShowFiles;
}) {
  const t = useT();

  return (
    <header className="col-span-2 flex h-11 items-center gap-3 border-b border-line px-3">
      <div className="flex items-center gap-2.5 pr-2">
        <BrandMark />
        <span className="text-[13px] font-bold tracking-[0.2em]">CUELITH</span>
      </div>

      <ShowMenu files={files} />
      <span aria-hidden="true" className="h-5 w-px bg-line-2" />

      <nav aria-label={t("core.modes.label")} className="flex items-center gap-1.5">
        {modes.map((mode) => {
          const selected = mode.qualifiedId === active.qualifiedId;
          return (
            <button
              key={mode.qualifiedId}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onSelect(mode);
              }}
              className={`rounded-md border px-3 py-1 text-[13px] ${
                selected
                  ? "border-fg bg-fg font-semibold text-bg"
                  : "border-line-2 text-muted hover:text-fg"
              }`}
            >
              {t(mode.title)}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <OutputsBar onManage={onManageOutputs} />
    </header>
  );
}

/**
 * Uscite nella barra in alto: stato (pallino), Nero e Blocca per ognuna,
 * come comandi per singola uscita (cap. 07). Le altre continuano.
 */
function OutputsBar({ onManage }: { onManage: () => void }) {
  const t = useT();
  const { state } = useEngine();
  const run = useRun();
  const outputs = Object.values(state?.show.outputs ?? {});
  return (
    <div
      role="group"
      aria-label={t("core.outputs.label")}
      className="flex min-w-0 items-center gap-3 overflow-x-auto text-[13px]"
    >
      {outputs.length === 0 && <span className="text-faint">{t("core.outputs.none")}</span>}
      {outputs.map((output) => {
        const live = state?.live.outputs[output.id];
        const error = live?.status === "error";
        return (
          <div
            key={output.id}
            role="group"
            aria-label={output.name}
            data-output={output.id}
            className="flex shrink-0 items-center gap-1.5"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${error ? "bg-stage" : live?.blackout ? "bg-line-2" : "bg-live"}`}
            />
            <span
              className={error ? "text-stage" : "text-muted"}
              title={error && live.error !== undefined ? t(live.error) : undefined}
            >
              {output.name}
            </span>
            <Button
              size="sm"
              tone={live?.blackout ? "live" : "default"}
              aria-pressed={live?.blackout ?? false}
              title={t("core.outputs.blackoutHint", { name: output.name })}
              onClick={() =>
                void run("output.blackout", { outputId: output.id, on: !(live?.blackout ?? false) })
              }
            >
              {t("core.outputs.blackout")}
            </Button>
            <Button
              size="sm"
              tone={live?.freeze ? "cue" : "default"}
              aria-pressed={live?.freeze ?? false}
              title={t("core.outputs.freezeHint", { name: output.name })}
              onClick={() =>
                void run("output.freeze", { outputId: output.id, on: !(live?.freeze ?? false) })
              }
            >
              {t("core.outputs.freeze")}
            </Button>
          </div>
        );
      })}
      <Button size="sm" onClick={onManage}>
        {t(outputs.length === 0 ? "core.outputs.add" : "core.outputs.manage")}
      </Button>
    </div>
  );
}

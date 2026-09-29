import { useEngine, useT } from "../engine/react.js";
import type { Mode } from "../modes/core.js";

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
}: {
  modes: readonly Mode[];
  active: Mode;
  onSelect: (mode: Mode) => void;
}) {
  const t = useT();
  const { state } = useEngine();
  const outputs = Object.values(state?.show.outputs ?? {});

  return (
    <header className="col-span-2 flex h-11 items-center gap-3 border-b border-line px-3">
      <div className="flex items-center gap-2.5 pr-2">
        <BrandMark />
        <span className="text-[13px] font-bold tracking-[0.2em]">CUELITH</span>
      </div>

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

      <div aria-label={t("core.outputs.label")} className="flex items-center gap-2 text-[13px]">
        {outputs.length === 0 ? (
          <span className="text-faint">{t("core.outputs.none")}</span>
        ) : (
          outputs.map((output) => (
            <span key={output.id} className="flex items-center gap-1.5 text-muted">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-live" />
              {output.name}
            </span>
          ))
        )}
      </div>
    </header>
  );
}

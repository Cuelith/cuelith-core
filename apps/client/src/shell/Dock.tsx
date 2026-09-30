import { useT } from "../engine/react.js";
import type { ModulePanel } from "../station/modulePanels.js";
import { useStation } from "../station/station.js";
import { showTab } from "../station/tabs.js";

/** Sigla di due lettere dal titolo del pannello, come nel dock del documento ("BI", "TI"...). */
function initials(title: string): string {
  const words = title.split(/s+/).filter((w) => w !== "");
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : title.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Dock dei moduli (cap. 04): un'icona per ogni pannello dei moduli attivi e,
 * in fondo, il "+" che apre la finestra Moduli. Un pannello laterale si apre
 * come scheda a sinistra; uno centrale prende il posto della colonna Slide.
 */
export function Dock({
  panels,
  onManageModules,
}: {
  panels: readonly ModulePanel[];
  onManageModules: () => void;
}) {
  const t = useT();
  const { centerPanel, openCenterPanel, closeCenterPanel } = useStation();
  return (
    <nav
      aria-label={t("core.dock.label")}
      className="flex flex-col items-center gap-2 border-r border-line py-2.5"
    >
      {panels.map((panel) => {
        const open = panel.placement === "center" && centerPanel?.id === panel.id;
        return (
          <button
            key={panel.id}
            type="button"
            aria-label={t(panel.title)}
            title={t(panel.title)}
            aria-pressed={panel.placement === "center" ? open : undefined}
            onClick={() => {
              if (panel.placement === "center") {
                if (open) closeCenterPanel();
                else openCenterPanel(panel.id);
              } else showTab(panel.id);
            }}
            className={`grid h-8 w-8 place-items-center rounded-lg font-mono text-[10px] font-semibold ${
              open
                ? "bg-mod text-mod-bg"
                : "bg-mod-chip text-mod hover:outline hover:outline-mod-line"
            }`}
          >
            {initials(t(panel.title))}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onManageModules}
        aria-label={t("core.dock.addModule")}
        title={t("core.dock.addModule")}
        className="grid h-8 w-8 place-items-center rounded-lg border border-dashed border-faint text-lg leading-none text-muted hover:border-muted hover:text-fg"
      >
        +
      </button>
    </nav>
  );
}

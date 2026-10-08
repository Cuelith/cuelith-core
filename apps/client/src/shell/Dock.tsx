import { useCan } from "../station/roles.js";
import { useT } from "../engine/react.js";
import type { ModulePanel } from "../station/modulePanels.js";
import { usePins } from "../station/pins.js";
import { showTab } from "../station/tabs.js";
import type { PaletteFilter } from "./Palette.js";

/** Sigla di due lettere, solo per un modulo che non ha ancora un'icona. */
function initials(title: string): string {
  const words = title.split(/\s+/).filter((w) => w !== "");
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : title.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Colonna degli strumenti (cap. 04): un'icona per ogni modulo attivo (con uno
 * strumento a sinistra) e, in fondo, il "+" che apre la finestra Moduli. Un
 * clic apre la scheda dello strumento nella colonna di sinistra, nient'altro:
 * gli editor si aprono dai comandi, in una finestra propria. I moduli passivi
 * (lingue, servizi) non compaiono qui.
 */
export function Dock({
  panels,
  onManageModules,
  onOpenPalette,
}: {
  panels: readonly ModulePanel[];
  onManageModules: () => void;
  onOpenPalette: (filter: PaletteFilter) => void;
}) {
  const t = useT();
  const allTools = panels.filter((panel) => panel.placement === "side");
  // Nella colonna ci sono i preferiti (finche' non si sceglie, tutti); gli altri stanno nella ricerca.
  const pins = usePins(allTools.map((panel) => panel.id));
  const tools = allTools.filter((panel) => pins.isPinned(panel.id));
  const canManage = useCan("plugins");
  return (
    <nav
      aria-label={t("core.dock.label")}
      className="flex min-h-0 flex-col items-center gap-2 border-r border-line py-2.5"
    >
      <div className="flex shrink-0 flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => {
            onOpenPalette("all");
          }}
          aria-label={t("core.dock.search")}
          title={t("core.dock.search")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-2 text-muted hover:border-faint hover:text-fg"
        >
          <svg
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M13 13l4.5 4.5" strokeLinecap="round" />
          </svg>
        </button>
        {allTools.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onOpenPalette("plugins");
            }}
            aria-label={t("core.dock.all")}
            title={t("core.dock.all")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line-2 text-muted hover:border-faint hover:text-fg"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
              <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
              <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
              <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
            </svg>
          </button>
        )}
      </div>
      {/* Con molti plugin le icone scorrono; il "+" resta sempre raggiungibile sotto. */}
      <div
        data-dock-tools=""
        className="flex min-h-0 flex-col items-center gap-2 overflow-y-auto px-2 py-0.5 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        {tools.map((panel) => (
          <button
            key={panel.id}
            type="button"
            aria-label={t(panel.title)}
            title={t(panel.title)}
            onClick={() => {
              pins.markUsed(panel.id);
              showTab(panel.id);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-mod-chip font-mono text-[10px] font-semibold text-mod hover:outline hover:outline-mod-line"
          >
            {panel.icon === undefined ? (
              initials(t(panel.title))
            ) : (
              <img src={panel.icon} alt="" className="h-6 w-6" draggable={false} />
            )}
          </button>
        ))}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onManageModules}
          aria-label={t("core.dock.addModule")}
          title={t("core.dock.addModule")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-dashed border-faint text-lg leading-none text-muted hover:border-muted hover:text-fg"
        >
          +
        </button>
      )}
    </nav>
  );
}

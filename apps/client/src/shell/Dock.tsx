import { useT } from "../engine/react.js";
import type { ModulePanel } from "../station/modulePanels.js";
import { showTab } from "../station/tabs.js";

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
}: {
  panels: readonly ModulePanel[];
  onManageModules: () => void;
}) {
  const t = useT();
  const tools = panels.filter((panel) => panel.placement === "side");
  return (
    <nav
      aria-label={t("core.dock.label")}
      className="flex flex-col items-center gap-2 border-r border-line py-2.5"
    >
      {tools.map((panel) => (
        <button
          key={panel.id}
          type="button"
          aria-label={t(panel.title)}
          title={t(panel.title)}
          onClick={() => {
            showTab(panel.id);
          }}
          className="grid h-9 w-9 place-items-center rounded-lg bg-mod-chip font-mono text-[10px] font-semibold text-mod hover:outline hover:outline-mod-line"
        >
          {panel.icon === undefined ? (
            initials(t(panel.title))
          ) : (
            <img src={panel.icon} alt="" className="h-6 w-6" draggable={false} />
          )}
        </button>
      ))}
      <button
        type="button"
        onClick={onManageModules}
        aria-label={t("core.dock.addModule")}
        title={t("core.dock.addModule")}
        className="grid h-9 w-9 place-items-center rounded-lg border border-dashed border-faint text-lg leading-none text-muted hover:border-muted hover:text-fg"
      >
        +
      </button>
    </nav>
  );
}

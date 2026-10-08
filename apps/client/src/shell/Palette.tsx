import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import type { Mode } from "../modes/core.js";
import type { ModulePanel } from "../station/modulePanels.js";
import { search, type PaletteEntry, type PaletteKind } from "../station/palette.js";
import { usePins } from "../station/pins.js";
import { useRun, useStation } from "../station/station.js";
import { showTab } from "../station/tabs.js";
import type { Section } from "./SettingsDialog.js";

/** Quali voci si vedono: tutte, o solo un tipo (le chiavi sono i gruppi dei chip). */
export type PaletteFilter = "all" | "plugins" | "commands" | "items";

const FILTERS: readonly PaletteFilter[] = ["all", "plugins", "commands", "items"];
const FILTER_KINDS: Readonly<Record<PaletteFilter, readonly PaletteKind[] | undefined>> = {
  all: undefined,
  plugins: ["plugin"],
  commands: ["command", "mode", "app"],
  items: ["item"],
};

/** Sigla di due lettere, solo per un plugin che non ha ancora un'icona. */
function initials(title: string): string {
  const words = title.split(/\s+/).filter((w) => w !== "");
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : title.slice(0, 2);
  return letters.toUpperCase();
}

interface Action extends PaletteEntry {
  readonly run: () => void;
  readonly icon?: string | undefined;
  /** Id dello strumento, per la stella dei preferiti. */
  readonly panelId?: string | undefined;
}

/**
 * «Cerca e vai» (Ctrl+K, decisione 0017): un campo, e sotto plugin, comandi, disposizioni,
 * impostazioni ed elementi della scaletta che corrispondono. Frecce e Invio, solo tastiera.
 * Aperta senza scrivere mostra tutti i plugin (con la stella per fissarli nella colonna delle icone).
 */
export function Palette({
  panels,
  modes,
  activeMode,
  onSelectMode,
  onOpenSettings,
  onManageModules,
  onManageOutputs,
  settingsPlugins,
  onOpenPluginSettings,
  onOpenWelcome,
  initialFilter,
  onClose,
}: {
  panels: readonly ModulePanel[];
  modes: readonly Mode[];
  activeMode: Mode;
  onSelectMode: (mode: Mode) => void;
  onOpenSettings: (section: Section) => void;
  onManageModules: () => void;
  onManageOutputs: () => void;
  /** Plugin con impostazioni (anche non attivi). */
  settingsPlugins: readonly { id: string; name: string; icon: string | undefined }[];
  onOpenPluginSettings: (pluginId: string) => void;
  onOpenWelcome: () => void;
  initialFilter: PaletteFilter;
  onClose: () => void;
}) {
  const t = useT();
  const run = useRun();
  const { state } = useEngine();
  const { select } = useStation();
  const tools = useMemo(() => panels.filter((panel) => panel.placement === "side"), [panels]);
  const pins = usePins(tools.map((panel) => panel.id));
  const [element, setElement] = useState<HTMLDialogElement | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PaletteFilter>(initialFilter);
  const [active, setActive] = useState(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const rows = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    if (element === null || element.open) return;
    element.showModal();
    // L'autofocus scatta prima dell'apertura: il campo si prende il fuoco adesso. Se una finestra
    // appena chiusa lo ridava all'elemento di prima, lo si riprende un attimo dopo.
    const focusInput = () => {
      if (!element.contains(document.activeElement)) element.querySelector("input")?.focus();
    };
    element.querySelector("input")?.focus();
    const later = setTimeout(focusInput, 150);
    return () => {
      clearTimeout(later);
    };
  }, [element]);
  const close = () => {
    element?.close();
  };

  const bare = state?.live.textHidden === true;
  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [];
    // Strumenti dei plugin: gli ultimi usati per primi, gli altri come sono.
    const rank = (id: string) => {
      const index = pins.recent.indexOf(id);
      return index === -1 ? pins.recent.length : index;
    };
    [...tools]
      .sort((a, b) => rank(a.id) - rank(b.id))
      .forEach((panel) => {
        list.push({
          id: `plugin:${panel.id}`,
          kind: "plugin",
          title: t(panel.title),
          subtitle: panel.pluginName === t(panel.title) ? undefined : panel.pluginName,
          panelId: panel.id,
          icon: panel.icon,
          run: () => {
            pins.markUsed(panel.id);
            showTab(panel.id);
          },
        });
      });
    const command = (id: string, title: string, subtitle: string | undefined, go: () => void) => {
      list.push({ id: `command:${id}`, kind: "command", title, subtitle, run: go });
    };
    command("next", t("core.program.next"), "→", () => void run("cue.next", {}));
    command("prev", t("core.program.prev"), "←", () => void run("cue.prev", {}));
    command("take", t("core.preview.take"), "↵", () => void run("cue.take", {}));
    command(
      "clear",
      t("core.program.clear"),
      undefined,
      () => void run("layer.clear", { layer: "content" }),
    );
    command(
      "bare",
      t("core.program.bare"),
      bare ? "✓" : undefined,
      () => void run("live.textHidden", { hidden: !bare }),
    );
    for (const mode of modes) {
      list.push({
        id: `mode:${mode.qualifiedId}`,
        kind: "mode",
        title: t(mode.title),
        subtitle: mode.qualifiedId === activeMode.qualifiedId ? "✓" : undefined,
        run: () => {
          onSelectMode(mode);
        },
      });
    }
    const app = (id: string, title: string, go: () => void, keywords?: string) => {
      list.push({ id: `app:${id}`, kind: "app", title, keywords, run: go });
    };
    app("settings", t("core.settings.title"), () => {
      onOpenSettings("general");
    });
    app("shortcuts", t("core.settings.section.shortcuts"), () => {
      onOpenSettings("shortcuts");
    });
    app("outputs", t("core.settings.outputs.open"), onManageOutputs);
    app("plugins", t("core.dock.addModule"), onManageModules);
    app("welcome", t("core.welcome.title"), onOpenWelcome, t("core.welcome.keywords"));
    for (const plugin of settingsPlugins) {
      list.push({
        id: `app:settings:${plugin.id}`,
        kind: "app",
        title: t("core.pluginSettings.title", { name: plugin.name }),
        keywords: `${plugin.name} ${t("core.pluginSettings.open")}`,
        icon: plugin.icon,
        run: () => {
          onOpenPluginSettings(plugin.id);
        },
      });
    }
    // Elementi della scaletta: si portano in anteprima (mai direttamente in onda).
    for (const entry of state?.show.playlist ?? []) {
      const item = state?.show.items[entry.itemId];
      if (item === undefined) continue;
      list.push({
        id: `item:${entry.id}`,
        kind: "item",
        title: item.title === "" ? t("core.editor.untitled") : item.title,
        run: () => {
          select(entry.id);
          void run("preview.set", { entryId: entry.id, slideIndex: 0 });
        },
      });
    }
    return list;
  }, [
    tools,
    pins,
    modes,
    activeMode,
    state,
    bare,
    t,
    run,
    select,
    onSelectMode,
    onOpenSettings,
    onManageModules,
    onManageOutputs,
    settingsPlugins,
    onOpenPluginSettings,
    onOpenWelcome,
  ]);

  const kinds = FILTER_KINDS[filter];
  const results = useMemo(
    () =>
      search(
        kinds === undefined ? actions : actions.filter((entry) => kinds.includes(entry.kind)),
        query,
      ).map((entry) => entry as Action),
    [actions, kinds, query],
  );
  // La voce scelta resta dentro l'elenco quando cambia la ricerca.
  const current = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    rows.current.get(current)?.scrollIntoView({ block: "nearest" });
  }, [current, results]);

  const go = (entry: Action | undefined) => {
    if (entry === undefined) return;
    close();
    // Lo stato si aggiorna subito, senza attendere l'evento di chiusura: un Ctrl+K dato subito dopo
    // deve riaprire, non richiudere.
    onClose();
    entry.run();
  };
  const allPanelIds = tools.map((panel) => panel.id);
  const showGroups = query.trim() === "";

  return (
    <dialog
      ref={setElement}
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      // Esc chiude subito (senza attendere l'evento di chiusura): un Ctrl+K dato subito dopo riapre.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-label={t("core.palette.title")}
      data-palette=""
      className="mx-auto mt-[10vh] mb-auto w-[min(640px,calc(100vw-32px))] rounded-xl border border-line-2 bg-bg-2 p-0 text-fg backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results.length > 0 ? optionId(current) : undefined}
          aria-label={t("core.palette.title")}
          placeholder={t("core.palette.placeholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (results.length === 0) return;
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((current + step + results.length) % results.length);
            } else if (event.key === "Enter") {
              event.preventDefault();
              go(results[current]);
            }
          }}
          className="w-full rounded-md border border-line-2 bg-bg px-3 py-2 text-sm"
        />
        <div role="group" aria-label={t("core.palette.filters")} className="flex gap-1.5">
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={filter === name}
              onClick={() => {
                setFilter(name);
                setActive(0);
              }}
              className={`rounded-md border px-2 py-0.5 text-xs ${
                filter === name
                  ? "border-cue bg-cue-bg text-fg"
                  : "border-line-2 text-muted hover:text-fg"
              }`}
            >
              {t(`core.palette.filter.${name}`)}
            </button>
          ))}
        </div>
      </div>
      <ul
        id={listId}
        role="listbox"
        aria-label={t("core.palette.results")}
        className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5"
      >
        {results.length === 0 && (
          <li role="presentation" className="px-3 py-6 text-center text-sm text-faint">
            {t("core.palette.empty", { query: query.trim() })}
          </li>
        )}
        {results.map((entry, index) => {
          const header =
            showGroups && (index === 0 || results[index - 1]?.kind !== entry.kind)
              ? t(`core.palette.group.${entry.kind}`)
              : undefined;
          return (
            <li key={entry.id} role="presentation">
              {header !== undefined && (
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  {header}
                </p>
              )}
              <div
                id={optionId(index)}
                role="option"
                aria-selected={index === current}
                ref={(node) => {
                  if (node === null) rows.current.delete(index);
                  else rows.current.set(index, node);
                }}
                onMouseMove={() => {
                  if (index !== current) setActive(index);
                }}
                onClick={() => {
                  go(entry);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 ${
                  index === current ? "bg-cue-bg" : ""
                }`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-mod-chip font-mono text-[10px] font-semibold text-mod">
                  {entry.icon !== undefined ? (
                    <img src={entry.icon} alt="" className="h-5 w-5" draggable={false} />
                  ) : entry.kind === "plugin" ? (
                    initials(entry.title)
                  ) : (
                    <span aria-hidden="true">{GLYPH[entry.kind]}</span>
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{entry.title}</span>
                  {entry.subtitle !== undefined && entry.kind === "plugin" && (
                    <span className="truncate text-xs text-faint">{entry.subtitle}</span>
                  )}
                </span>
                {entry.subtitle !== undefined && entry.kind !== "plugin" && (
                  <span className="text-xs text-muted">{entry.subtitle}</span>
                )}
                {!showGroups && (
                  <span className="text-[10px] uppercase tracking-[0.1em] text-faint">
                    {t(`core.palette.group.${entry.kind}`)}
                  </span>
                )}
                {entry.panelId !== undefined && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-pressed={pins.isPinned(entry.panelId)}
                    aria-label={t("core.palette.pin", { name: entry.title })}
                    title={t("core.palette.pin", { name: entry.title })}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (entry.panelId !== undefined) pins.toggle(entry.panelId, allPanelIds);
                    }}
                    className={`grid h-7 w-7 place-items-center rounded-md text-base hover:bg-line ${
                      pins.isPinned(entry.panelId) ? "text-cue" : "text-faint"
                    }`}
                  >
                    {pins.isPinned(entry.panelId) ? "★" : "☆"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}

/** Segno nel riquadro delle voci che non sono plugin. */
const GLYPH: Readonly<Record<PaletteKind, string>> = {
  plugin: "",
  command: "▶",
  mode: "▦",
  app: "⚙",
  item: "≡",
};

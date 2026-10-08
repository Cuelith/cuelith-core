import { useCallback, useEffect, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { CORE_MODES, PRESENT_MODE, type Mode } from "../modes/core.js";
import { useShowFiles, type ShowFiles } from "../station/files.js";
import { ModuleEditorsContext, pluginIconUrl, useModuleUi } from "../station/modulePanels.js";
import { useCueShortcuts } from "../station/shortcuts.js";
import { preparePanelWindows, StationProvider, useStation } from "../station/station.js";
import { Dock } from "./Dock.js";
import { Palette, type PaletteFilter } from "./Palette.js";
import { PluginSettingsDialog } from "./modules/PluginSettingsDialog.js";
import { ResourceWatch } from "./ResourceWatch.js";
import { WelcomeDialog } from "./modules/WelcomeDialog.js";
import { useCan } from "../station/roles.js";
import { PluginSettingsContext } from "../station/pluginSettings.js";
import { ModeView } from "./ModeView.js";
import { ModulesWindow } from "./modules/ModulesWindow.js";
import { Notices } from "./Notices.js";
import { OutputsDialog } from "./OutputsDialog.js";
import { RecoveryBanner } from "./RecoveryBanner.js";
import { SettingsDialog, type Section } from "./SettingsDialog.js";
import { useAppInfo, useUpdateReady } from "../station/appInfo.js";
import { UnsavedDialog } from "./UnsavedDialog.js";
import { ItemEditorDialog } from "./ItemEditorDialog.js";
import { TopBar } from "./TopBar.js";
import { useFollowDirect } from "../station/direct.js";

const MODE_KEY = "cuelith.mode";

function readSavedMode(modes: readonly Mode[]): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return modes.find((m) => m.qualifiedId === saved) ?? PRESENT_MODE;
  } catch {
    return PRESENT_MODE;
  }
}

/** "Mod+1" -> Ctrl (Windows/Linux) o Cmd (Mac) + 1. */
function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts[parts.length - 1];
  const mod = parts.includes("Mod");
  return (
    (event.ctrlKey || event.metaKey) === mod &&
    event.shiftKey === parts.includes("Shift") &&
    event.altKey === parts.includes("Alt") &&
    event.key.toUpperCase() === key?.toUpperCase()
  );
}

export function Shell() {
  return (
    <StationProvider>
      <ShellBody />
    </StationProvider>
  );
}

function ShellBody() {
  const t = useT();
  const { status } = useEngine();
  const { editor, unsavedQuestion, notify } = useStation();
  // Aggiornamento scaricato: un avviso una volta e il puntino sull'ingranaggio.
  const updateReady = useUpdateReady((version) => {
    notify("core.updates.readyNotice", { version }, "info");
  });
  const files = useShowFiles();
  const { panels: modulePanels, editors, installed, ready } = useModuleUi();
  useCueShortcuts();
  useFollowDirect();
  // Editor dei moduli pronti in anticipo (finestre nascoste): si aprono all'istante.
  const editorIds = modulePanels
    .filter((panel) => panel.placement === "center")
    .map((panel) => panel.id)
    .join(" ");
  useEffect(() => {
    preparePanelWindows(editorIds === "" ? [] : editorIds.split(" "));
  }, [editorIds]);
  useFileShortcuts(files);
  const modes = CORE_MODES;
  const [mode, setMode] = useState<Mode>(() => readSavedMode(modes));
  const [modulesOpen, setModulesOpen] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState<Section | undefined>();
  const [palette, setPalette] = useState<PaletteFilter | undefined>();
  // Avvio guidato: la prima volta, finche' non c'e' nessuno strumento installato (decisione 0018).
  const [welcomeAsked, setWelcomeAsked] = useState(false);
  // Solo sul computer del motore (app desktop): da un browser in rete non si installano plugin.
  const { info: appInfo, reload: reloadAppInfo } = useAppInfo();
  const canManage = useCan("plugins");
  const hasTools = modulePanels.some((panel) => panel.placement === "side");
  const welcome =
    welcomeAsked ||
    (ready && !hasTools && canManage && appInfo !== undefined && !appInfo.welcomeSeen);
  // Impostazioni di un plugin: una sola finestra, aperta da scheda, finestra Plugin o ricerca.
  const [settingsOf, setSettingsOf] = useState<string | undefined>();
  const withSettings = installed.filter((p) => (p.manifest.contributes.settings ?? []).length > 0);
  const settingsIds = new Set(withSettings.map((p) => p.manifest.id));
  const settingsAccess = {
    has: (pluginId: string) => settingsIds.has(pluginId),
    open: setSettingsOf,
  };
  const settingsPlugin = installed.find((p) => p.manifest.id === settingsOf);

  const selectMode = useCallback((next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next.qualifiedId);
    } catch {
      // La modalita' scelta vale comunque per questa sessione.
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const match = modes.find(
        (m) => m.shortcut !== undefined && matchesShortcut(event, m.shortcut),
      );
      // Ctrl+K: «Cerca e vai» (di nuovo Ctrl+K la chiude). Con un'altra finestra aperta non si impila.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        const others = [...document.querySelectorAll("dialog[open]")].some(
          (dialog) => !dialog.hasAttribute("data-palette"),
        );
        if (others) return;
        event.preventDefault();
        setPalette((open) => (open === undefined ? "all" : undefined));
        return;
      }
      // Ctrl+, apre le impostazioni (come nella maggior parte dei programmi).
      // Per tasto o per posizione (layout di tastiera diversi, Linux).
      const comma = event.key === "," || event.code === "Comma";
      if ((event.ctrlKey || event.metaKey) && comma && !event.altKey) {
        event.preventDefault();
        setSettingsOpen("general");
        return;
      }
      if (match === undefined) return;
      event.preventDefault();
      selectMode(match);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [modes, selectMode]);

  return (
    <ModuleEditorsContext.Provider value={editors}>
      <PluginSettingsContext.Provider value={settingsAccess}>
        <div className="flex h-full flex-col">
          <RecoveryBanner files={files} />
          <div className="grid min-h-0 flex-1 grid-cols-[48px_1fr] grid-rows-[44px_1fr]">
            <TopBar
              modes={modes}
              active={mode}
              onSelect={selectMode}
              onManageOutputs={() => {
                setOutputsOpen(true);
              }}
              updateReady={updateReady}
              onOpenResources={() => {
                setSettingsOpen("resources");
              }}
              onOpenSettings={() => {
                setSettingsOpen("general");
              }}
              files={files}
            />
            <Dock
              panels={modulePanels}
              onManageModules={() => {
                setModulesOpen(true);
              }}
              onOpenPalette={setPalette}
            />
            <ModeView mode={mode} modulePanels={modulePanels} />
          </div>
          {palette !== undefined && (
            <Palette
              panels={modulePanels}
              modes={modes}
              activeMode={mode}
              onSelectMode={selectMode}
              onOpenSettings={setSettingsOpen}
              onManageModules={() => {
                setModulesOpen(true);
              }}
              onManageOutputs={() => {
                setOutputsOpen(true);
              }}
              settingsPlugins={withSettings.map((p) => ({
                id: p.manifest.id,
                name: p.manifest.name,
                icon: pluginIconUrl(p.manifest),
              }))}
              onOpenPluginSettings={setSettingsOf}
              onOpenWelcome={() => {
                setWelcomeAsked(true);
              }}
              initialFilter={palette}
              onClose={() => {
                setPalette(undefined);
              }}
            />
          )}
          {settingsPlugin !== undefined && (
            <PluginSettingsDialog
              key={settingsPlugin.manifest.id}
              plugin={settingsPlugin}
              onClose={() => {
                setSettingsOf(undefined);
              }}
            />
          )}
          {welcome && (
            <WelcomeDialog
              onClose={() => {
                setWelcomeAsked(false);
                void window.cuelithDesktop?.setWelcomeSeen().then(reloadAppInfo);
              }}
              onOpenPlugins={() => {
                setModulesOpen(true);
              }}
            />
          )}
          {modulesOpen && (
            <ModulesWindow
              onClose={() => {
                setModulesOpen(false);
              }}
            />
          )}
          {editor !== undefined && (
            <ItemEditorDialog
              key={"itemId" in editor ? `${editor.mode}:${editor.itemId}` : editor.mode}
              request={editor}
            />
          )}
          {settingsOpen !== undefined && (
            <SettingsDialog
              initialSection={settingsOpen}
              onClose={() => {
                setSettingsOpen(undefined);
              }}
              onManageOutputs={() => {
                setOutputsOpen(true);
              }}
              onManageModules={() => {
                setModulesOpen(true);
              }}
            />
          )}
          <OutputsDialog
            open={outputsOpen}
            onClose={() => {
              setOutputsOpen(false);
            }}
          />
          {unsavedQuestion !== undefined && (
            <UnsavedDialog key={unsavedQuestion} question={unsavedQuestion} />
          )}
          <Notices />
          <ResourceWatch installed={installed} />
          {status.kind === "lost" && (
            <div
              role="status"
              className="fixed inset-x-0 top-0 z-50 bg-stage px-4 py-2 text-center text-sm font-semibold text-bg"
            >
              {t("core.connection.lost")}
            </div>
          )}
        </div>
      </PluginSettingsContext.Provider>
    </ModuleEditorsContext.Provider>
  );
}

/** Ctrl/⌘+N nuovo, +O apri, +S salva, +Maiusc+S salva con nome. */
function useFileShortcuts(files: ShowFiles): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.repeat) return;
      if (document.querySelector("dialog[open]") !== null) return;
      const key = event.key.toLowerCase();
      const action =
        key === "s"
          ? event.shiftKey
            ? files.saveAs
            : files.save
          : key === "o" && !event.shiftKey
            ? files.open
            : key === "n" && !event.shiftKey
              ? files.newShow
              : undefined;
      if (action === undefined) return;
      event.preventDefault();
      void action();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [files]);
}

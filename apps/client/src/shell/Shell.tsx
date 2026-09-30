import { useCallback, useEffect, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { CORE_MODES, PRESENT_MODE, type Mode } from "../modes/core.js";
import { useShowFiles, type ShowFiles } from "../station/files.js";
import { useModulePanels } from "../station/modulePanels.js";
import { useCueShortcuts } from "../station/shortcuts.js";
import { StationProvider, useStation } from "../station/station.js";
import { Dock } from "./Dock.js";
import { ModeView } from "./ModeView.js";
import { ModulesWindow } from "./modules/ModulesWindow.js";
import { Notices } from "./Notices.js";
import { OutputsDialog } from "./OutputsDialog.js";
import { RecoveryBanner } from "./RecoveryBanner.js";
import { UnsavedDialog } from "./UnsavedDialog.js";
import { ItemEditorDialog } from "./ItemEditorDialog.js";
import { TopBar } from "./TopBar.js";

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
  const { editor, unsavedQuestion } = useStation();
  const files = useShowFiles();
  const modulePanels = useModulePanels();
  useCueShortcuts();
  useFileShortcuts(files);
  const modes = CORE_MODES;
  const [mode, setMode] = useState<Mode>(() => readSavedMode(modes));
  const [modulesOpen, setModulesOpen] = useState(false);
  const [outputsOpen, setOutputsOpen] = useState(false);

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
          files={files}
        />
        <Dock
          panels={modulePanels}
          onManageModules={() => {
            setModulesOpen(true);
          }}
        />
        <ModeView mode={mode} modulePanels={modulePanels} />
      </div>
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
      {status.kind === "lost" && (
        <div
          role="status"
          className="fixed inset-x-0 top-0 z-50 bg-stage px-4 py-2 text-center text-sm font-semibold text-bg"
        >
          {t("core.connection.lost")}
        </div>
      )}
    </div>
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

import { useCallback, useEffect, useState } from "react";
import { useEngine, useT } from "../engine/react.js";
import { CORE_MODES, PRESENT_MODE, type Mode } from "../modes/core.js";
import { Dock } from "./Dock.js";
import { ModeView } from "./ModeView.js";
import { ModulesDialog } from "./ModulesDialog.js";
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
  const t = useT();
  const { status } = useEngine();
  const modes = CORE_MODES;
  const [mode, setMode] = useState<Mode>(() => readSavedMode(modes));
  const [modulesOpen, setModulesOpen] = useState(false);

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
    <div className="grid h-full grid-cols-[48px_1fr] grid-rows-[44px_1fr]">
      <TopBar modes={modes} active={mode} onSelect={selectMode} />
      <Dock
        onManageModules={() => {
          setModulesOpen(true);
        }}
      />
      <ModeView mode={mode} />
      <ModulesDialog
        open={modulesOpen}
        onClose={() => {
          setModulesOpen(false);
        }}
      />
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

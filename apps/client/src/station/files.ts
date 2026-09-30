import { useCallback, useMemo } from "react";
import { useEngine, useT } from "../engine/react.js";
import { useRun, useStation } from "./station.js";

export interface ShowFiles {
  /** Apri e Salva con nome richiedono la finestra nativa: solo sulla postazione del motore. */
  readonly canChooseFiles: boolean;
  readonly newShow: () => Promise<void>;
  readonly open: () => Promise<void>;
  readonly save: () => Promise<boolean>;
  readonly saveAs: () => Promise<boolean>;
  readonly reopenRecovery: () => Promise<void>;
}

/**
 * Comandi del file dello show. Prima di sostituire uno show con modifiche non
 * salvate si chiede Salva / Non salvare / Annulla, come ogni programma.
 */
export function useShowFiles(): ShowFiles {
  const t = useT();
  const { state } = useEngine();
  const { select, askUnsaved } = useStation();
  const run = useRun();
  const desktop = window.cuelithDesktop;
  const dirty = state?.live.dirty ?? false;
  const showPath = state?.live.showPath;
  const recoveryPath = state?.live.recovery?.path;

  const saveAs = useCallback(async (): Promise<boolean> => {
    if (desktop === undefined) return false;
    const path = await desktop.chooseShowFile("save");
    if (path === undefined) return false;
    return (await run("show.save", { path })) !== undefined;
  }, [desktop, run]);

  const save = useCallback(async (): Promise<boolean> => {
    if (showPath === undefined) return saveAs();
    return (await run("show.save", {})) !== undefined;
  }, [showPath, saveAs, run]);

  /** true se si puo' procedere (niente da salvare, salvato, o scartato). */
  const settle = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    const choice = await askUnsaved();
    if (choice === "cancel") return false;
    return choice === "discard" ? true : save();
  }, [dirty, askUnsaved, save]);

  const newShow = useCallback(async () => {
    if (!(await settle())) return;
    if ((await run("show.new", { name: t("core.show.newName") })) !== undefined) select(undefined);
  }, [settle, run, t, select]);

  const open = useCallback(async () => {
    if (desktop === undefined || !(await settle())) return;
    const path = await desktop.chooseShowFile("open");
    if (path === undefined) return;
    if ((await run("show.open", { path })) !== undefined) select(undefined);
  }, [desktop, settle, run, select]);

  const reopenRecovery = useCallback(async () => {
    if (recoveryPath === undefined || !(await settle())) return;
    if ((await run("show.open", { path: recoveryPath })) !== undefined) select(undefined);
  }, [recoveryPath, settle, run, select]);

  return useMemo(
    () => ({ canChooseFiles: desktop !== undefined, newShow, open, save, saveAs, reopenRecovery }),
    [desktop, newShow, open, save, saveAs, reopenRecovery],
  );
}

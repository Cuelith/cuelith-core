import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Engine } from "@cuelith-core/engine";
import { SHOW_FILE_EXTENSION } from "@cuelith/protocol";
import { app, dialog, type BrowserWindow } from "electron";

export type FileDialogKind = "open" | "save";

/** Cartella proposta la prima volta: Documenti/Cuelith. */
async function defaultFolder(): Promise<string> {
  const folder = path.join(app.getPath("documents"), "Cuelith");
  await mkdir(folder, { recursive: true }).catch(() => undefined);
  return folder;
}

function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? "show" : cleaned;
}

/**
 * Finestra nativa per scegliere un file di show. Restituisce il percorso o
 * undefined se l'operatore annulla. I testi arrivano dal modulo lingua.
 */
export async function chooseShowFile(
  parent: BrowserWindow,
  engine: Engine,
  kind: FileDialogKind,
): Promise<string | undefined> {
  const { locales } = engine.context;
  const translate = (key: string) => locales.t(key);
  const filters = [
    { name: translate("core.file.showFilter"), extensions: [SHOW_FILE_EXTENSION.slice(1)] },
  ];
  if (kind === "open") {
    const result = await dialog.showOpenDialog(parent, {
      title: translate("core.file.openTitle"),
      defaultPath: await defaultFolder(),
      filters,
      properties: ["openFile"],
    });
    return result.canceled ? undefined : result.filePaths[0];
  }
  const { name, showPath } = engine.context.store.read((doc) => ({
    name: doc.show.name,
    showPath: doc.live.showPath,
  }));
  const result = await dialog.showSaveDialog(parent, {
    title: translate("core.file.saveTitle"),
    defaultPath:
      showPath ?? path.join(await defaultFolder(), safeFileName(name) + SHOW_FILE_EXTENSION),
    filters,
  });
  if (result.canceled || result.filePath === "") return undefined;
  const chosen = result.filePath;
  return chosen.toLowerCase().endsWith(SHOW_FILE_EXTENSION) ? chosen : chosen + SHOW_FILE_EXTENSION;
}

/**
 * Prima di chiudere Cuelith con modifiche non salvate: Salva / Non salvare /
 * Annulla. Restituisce true se si puo' chiudere.
 */
export async function confirmUnsaved(parent: BrowserWindow, engine: Engine): Promise<boolean> {
  const { store, locales, shows } = engine.context;
  const { dirty, name, showPath } = store.read((doc) => ({
    dirty: doc.live.dirty,
    name: doc.show.name,
    showPath: doc.live.showPath,
  }));
  if (!dirty) return true;
  const { response } = await dialog.showMessageBox(parent, {
    type: "question",
    buttons: [
      locales.t("core.action.save"),
      locales.t("core.file.dontSave"),
      locales.t("core.action.cancel"),
    ],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: locales.t("core.file.unsavedQuestion", { name }),
    detail: locales.t("core.file.unsavedDetail"),
  });
  if (response === 2) return false;
  if (response === 1) return true;
  const target = showPath ?? (await chooseShowFile(parent, engine, "save"));
  if (target === undefined) return false;
  try {
    await shows.save(target);
    return true;
  } catch {
    await dialog.showMessageBox(parent, {
      type: "error",
      message: locales.t("core.file.saveFailed"),
    });
    return false;
  }
}

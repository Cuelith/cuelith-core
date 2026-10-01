import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEDIA_FORMATS, type Engine } from "@cuelith-core/engine";
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

/**
 * Finestra nativa per scegliere un modulo da installare: un pacchetto .cpkg
 * oppure la cartella di un modulo (per chi lo sta sviluppando, cap. 28).
 */
export async function chooseModuleFile(
  parent: BrowserWindow,
  engine: Engine,
  kind: "file" | "folder",
): Promise<string | undefined> {
  const { locales } = engine.context;
  const result = await dialog.showOpenDialog(
    parent,
    kind === "folder"
      ? { title: locales.t("core.file.chooseModuleFolder"), properties: ["openDirectory"] }
      : {
          title: locales.t("core.file.chooseModule"),
          filters: [{ name: locales.t("core.file.filter.module"), extensions: ["cpkg"] }],
          properties: ["openFile"],
        },
  );
  return result.canceled ? undefined : result.filePaths[0];
}

/** Finestra nativa per scegliere file audio o immagini da mettere nell'archivio media. */
export async function chooseMediaFiles(
  parent: BrowserWindow,
  engine: Engine,
  kind: "audio" | "image",
): Promise<string[]> {
  const { locales } = engine.context;
  const extensions = Object.entries(MEDIA_FORMATS)
    .filter(([, format]) => format.kind === kind)
    .map(([ext]) => ext);
  const result = await dialog.showOpenDialog(parent, {
    title: locales.t(kind === "audio" ? "core.file.chooseAudio" : "core.file.chooseImage"),
    filters: [{ name: locales.t(`core.file.filter.${kind}`), extensions }],
    properties: ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
}

/** Finestra "Salva" per un file di testo prodotto da un modulo (es. un canto esportato). */
export async function saveTextFile(
  parent: BrowserWindow,
  engine: Engine,
  name: string,
  content: string,
): Promise<void> {
  const result = await dialog.showSaveDialog(parent, {
    title: engine.context.locales.t("core.file.saveTitleGeneric"),
    defaultPath: path.join(await defaultFolder(), safeFileName(path.basename(name))),
  });
  if (result.canceled || result.filePath === "") return;
  await writeFile(result.filePath, content, "utf8");
}

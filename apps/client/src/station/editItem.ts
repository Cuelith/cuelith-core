import type { Item } from "@cuelith/protocol";
import { useCallback, useContext } from "react";
import { ModuleEditorsContext } from "./modulePanels.js";
import { useStation } from "./station.js";

/** Contesto passato all'editor di un modulo: quale elemento modificare. */
export interface EditContext {
  /** Elemento dell'archivio (se c'e'). */
  readonly libraryItemId?: string;
  /** Copia nello show da aggiornare dopo il salvataggio (se c'e'). */
  readonly showItemId?: string;
}

/**
 * "Modifica" apre l'editor giusto: quello dei testi per gli elementi del
 * nucleo, il pannello del modulo per i suoi tipi (es. i canti), cosi' strofe e
 * ritornelli non si rovinano.
 */
export function useEditItem(): {
  readonly editShowItem: (item: Pick<Item, "id" | "type" | "libraryRef">) => void;
  readonly editLibraryItem: (item: { readonly id: string; readonly type: string }) => void;
} {
  const editors = useContext(ModuleEditorsContext);
  const { openEditor, openCenterPanel, notify } = useStation();

  const editShowItem = useCallback(
    (item: Pick<Item, "id" | "type" | "libraryRef">) => {
      if (item.type === "core.text") {
        openEditor({ mode: "edit", itemId: item.id });
        return;
      }
      const editor = editors.get(item.type);
      if (editor === undefined) {
        notify("core.error.editorUnavailable");
        return;
      }
      const context: EditContext = {
        showItemId: item.id,
        ...(item.libraryRef === undefined ? {} : { libraryItemId: item.libraryRef.itemId }),
      };
      openCenterPanel(editor, context);
    },
    [editors, openEditor, openCenterPanel, notify],
  );

  const editLibraryItem = useCallback(
    (item: { readonly id: string; readonly type: string }) => {
      if (item.type === "core.text") {
        openEditor({ mode: "libraryEdit", itemId: item.id });
        return;
      }
      const editor = editors.get(item.type);
      if (editor === undefined) {
        notify("core.error.editorUnavailable");
        return;
      }
      openCenterPanel(editor, { libraryItemId: item.id } satisfies EditContext);
    },
    [editors, openEditor, openCenterPanel, notify],
  );

  return { editShowItem, editLibraryItem };
}

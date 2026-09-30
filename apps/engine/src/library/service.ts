import { join } from "node:path";
import {
  ErrorCode,
  newId,
  providerOf,
  RpcError,
  type Item,
  type MediaInfo,
  type StateDocument,
} from "@cuelith/protocol";
import type { ModuleRegistry } from "../modules/registry.js";
import { normalizeLive } from "../show/live.js";
import type { StateStore } from "../state/store.js";
import { MediaFiles } from "./media.js";
import { LibraryStore, type ItemQuery } from "./store.js";

import { CORE_ITEM_TYPES, declareItemType } from "../show/plugins.js";

export { CORE_ITEM_TYPES };

export interface LibraryServiceOptions {
  readonly store: StateStore;
  readonly modules: ModuleRegistry;
  /** Cartella dati dell'app: library.sqlite e media/. */
  readonly dataDir: string;
}

const invalid = (key: string) => new RpcError(ErrorCode.InvalidParameters, key);

/**
 * Librerie, archivio e media, e il loro rapporto con lo show: in scaletta va
 * una copia che ricorda l'originale (libraryRef), cosi' il file .cuelith si
 * apre ovunque. Ogni modifica alle librerie fa crescere live.libraryRev.
 */
export class LibraryService {
  readonly media: MediaFiles;
  readonly #o: LibraryServiceOptions;
  #db: LibraryStore | undefined;

  constructor(options: LibraryServiceOptions) {
    this.#o = options;
    this.media = new MediaFiles(join(options.dataDir, "media"));
  }

  async start(): Promise<void> {
    await this.media.start();
    this.#db = new LibraryStore(join(this.#o.dataDir, "library.sqlite"));
  }

  stop(): void {
    this.#db?.close();
    this.#db = undefined;
  }

  get db(): LibraryStore {
    if (this.#db === undefined) throw new Error("archivio non aperto");
    return this.#db;
  }

  /** Esegue una modifica alle librerie e lo segnala alle postazioni. */
  change<T>(fn: (db: LibraryStore) => T): T {
    const result = fn(this.db);
    this.#o.store.update((draft) => {
      draft.live.libraryRev += 1;
    });
    return result;
  }

  items(query: ItemQuery) {
    return this.db.items(query);
  }

  /** Controlli comuni a ogni elemento salvato: titolo, tipo noto, allegati presenti. */
  checkItem(item: Item): void {
    if (item.title.trim() === "") throw invalid("core.error.titleRequired");
    const installed = this.#o.modules.installed().map((p) => p.manifest.id);
    const provider = providerOf(item.type, installed);
    if (provider === undefined || (provider === "core" && !CORE_ITEM_TYPES.includes(item.type))) {
      throw invalid("core.error.itemTypeUnknown");
    }
    for (const attachment of item.attachments ?? []) {
      if (!this.db.hasMedia(attachment.mediaId)) throw invalid("core.error.mediaMissing");
    }
  }

  saveItem(item: Item, libraryId?: string): string {
    this.checkItem(item);
    return this.change((db) => {
      db.saveItem(item, libraryId);
      return item.id;
    });
  }

  duplicate(id: string, libraryId?: string): string {
    const { item } = this.db.getItem(id);
    const copy: Item = {
      ...structuredClone(item),
      id: newId(),
      slides: item.slides.map((slide) => ({ ...structuredClone(slide), id: newId() })),
      derivedFrom: id,
    };
    return this.saveItem(copy, libraryId);
  }

  async importMedia(path: string): Promise<MediaInfo> {
    const info = await this.media.import(path);
    this.change((db) => {
      db.addMedia(info);
    });
    return info;
  }

  /** Copia di un elemento di libreria pronta per lo show (id nuovo, slide con id propri). */
  #showCopy(id: string): Item {
    const { item, updatedAt } = this.db.getItem(id);
    return { ...structuredClone(item), id: newId(), libraryRef: { itemId: id, updatedAt } };
  }

  /** Copia di un elemento di libreria da mandare in onda senza scaletta (`live.direct`). */
  directCopy(libraryItemId: string): Item {
    return this.#showCopy(libraryItemId);
  }

  /** Mette in scaletta un elemento di libreria; riusa la copia se lo show ne ha gia' una aggiornata. */
  addToShow(draft: StateDocument, libraryItemId: string, index?: number): string {
    const { updatedAt } = this.db.getItem(libraryItemId);
    const existing = Object.values(draft.show.items).find(
      (i) => i.libraryRef?.itemId === libraryItemId && i.libraryRef.updatedAt === updatedAt,
    );
    const item = existing ?? this.#showCopy(libraryItemId);
    declareItemType(draft, item.type, this.#o.modules);
    if (existing === undefined) draft.show.items[item.id] = item;
    const playlist = draft.show.playlist;
    const at = index ?? playlist.length;
    if (at > playlist.length) throw invalid("core.error.indexOutOfRange");
    const entryId = newId();
    playlist.splice(at, 0, { id: entryId, itemId: item.id });
    return entryId;
  }

  /** Sostituisce il contenuto della copia nello show con la versione attuale della libreria. */
  refreshInShow(draft: StateDocument, showItemId: string): void {
    const current = draft.show.items[showItemId];
    if (current === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.itemNotFound");
    if (current.libraryRef === undefined) throw invalid("core.error.notFromLibrary");
    const fresh = this.#showCopy(current.libraryRef.itemId);
    draft.show.items[showItemId] = { ...fresh, id: showItemId };
    normalizeLive(draft);
  }

  /**
   * Salva nell'archivio un elemento dello show: se viene gia' da una libreria
   * aggiorna l'originale, altrimenti ne crea uno nuovo. Restituisce l'id in
   * archivio e la data, da scrivere nel riferimento della copia nello show.
   */
  saveFromShow(item: Item, libraryId?: string): { id: string; updatedAt: string } {
    const linked = item.libraryRef?.itemId;
    const exists = linked !== undefined && this.#exists(linked);
    const id = exists ? linked : newId();
    const { libraryRef: _ref, ...content } = structuredClone(item);
    const stored: Item = { ...content, id };
    this.checkItem(stored);
    const updatedAt = this.change((db) => db.saveItem(stored, exists ? undefined : libraryId));
    return { id, updatedAt };
  }

  #exists(id: string): boolean {
    try {
      this.db.getItem(id);
      return true;
    } catch {
      return false;
    }
  }
}

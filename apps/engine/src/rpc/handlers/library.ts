import { isDeepStrictEqual } from "node:util";
import { TextStyleSchema } from "@cuelith-core/core-looks";
import { ErrorCode, RpcError } from "@cuelith/protocol";
import type { EngineContext } from "../../context.js";
import type { HandlerMap } from "../dispatch.js";
import type { Session } from "../session.js";

/**
 * I comandi che leggono file del computer del motore sono solo per la
 * postazione locale: una postazione in rete non deve poter pescare file a
 * piacere (cap. 27). Dalla rete i file arriveranno caricandoli (passo 8).
 */
export function requireLocal(session: Session): void {
  if (!session.local) throw new RpcError(ErrorCode.Forbidden, "core.error.localOnly");
}

function showChange(ctx: EngineContext, mutate: Parameters<EngineContext["store"]["update"]>[0]) {
  return ctx.store.update((draft) => {
    mutate(draft);
    if (!ctx.store.read((doc) => isDeepStrictEqual(doc.show, draft.show))) draft.live.dirty = true;
  });
}

/** Uno stile globale deve avere la forma di uno stile di testo del nucleo, con tutti i campi base. */
function textStyleOf(style: Record<string, unknown>): Record<string, unknown> {
  const parsed = TextStyleSchema.safeParse(style);
  if (!parsed.success)
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.textStyleInvalid");
  return parsed.data;
}

/** Quanti stili globali al massimo: l'elenco deve restare leggibile e veloce. */
const MAX_TEXT_STYLES = 60;

export const libraryHandlers: HandlerMap = {
  "textstyle.list": (ctx) => ({ styles: ctx.library.db.textStyles() }),

  "textstyle.create": (ctx, _session, params) => {
    if (ctx.library.db.textStyles().length >= MAX_TEXT_STYLES) {
      throw new RpcError(ErrorCode.InvalidParameters, "core.error.textStyleLimit");
    }
    const style = textStyleOf(params.style);
    const id = ctx.library.change((db) => db.createTextStyle(params.name, style));
    return { id, rev: ctx.store.rev };
  },

  "textstyle.update": (ctx, _session, params) => {
    const style = params.style === undefined ? undefined : textStyleOf(params.style);
    ctx.library.change((db) => {
      db.updateTextStyle(params.id, { name: params.name, style });
    });
    return { rev: ctx.store.rev };
  },

  "textstyle.delete": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.deleteTextStyle(params.id);
    });
    return { rev: ctx.store.rev };
  },

  "library.list": (ctx) => ({ libraries: ctx.library.db.libraries() }),

  "library.create": (ctx, _session, params) => {
    const id = ctx.library.change((db) => db.createLibrary(params));
    return { id, rev: ctx.store.rev };
  },

  "library.update": (ctx, _session, params) => {
    const { id, ...patch } = params;
    ctx.library.change((db) => {
      db.updateLibrary(id, patch);
    });
    return { rev: ctx.store.rev };
  },

  "library.delete": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.deleteLibrary(params.id);
    });
    return { rev: ctx.store.rev };
  },

  "library.move": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.moveLibrary(params.id, params.toIndex);
    });
    return { rev: ctx.store.rev };
  },

  "library.items": (ctx, _session, params) => ctx.library.items(params),

  "library.tags": (ctx) => ({ tags: ctx.library.db.tags() }),

  "library.getItem": (ctx, _session, params) => ctx.library.db.getItem(params.id),

  "library.saveItem": (ctx, _session, params) => {
    const id = ctx.library.saveItem(params.item, params.libraryId);
    return { id, rev: ctx.store.rev };
  },

  "library.duplicateItem": (ctx, _session, params) => {
    const id = ctx.library.duplicate(params.id, params.libraryId);
    return { id, rev: ctx.store.rev };
  },

  "library.deleteItem": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.deleteItem(params.id);
    });
    return { rev: ctx.store.rev };
  },

  "library.saveFromShow": (ctx, _session, params) => {
    const item = ctx.store.read((doc) => doc.show.items[params.itemId]);
    if (item === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.itemNotFound");
    const saved = ctx.library.saveFromShow(item, params.libraryId);
    // La copia nello show ora e' allineata all'archivio.
    const rev = showChange(ctx, (draft) => {
      const copy = draft.show.items[params.itemId];
      if (copy !== undefined) copy.libraryRef = { itemId: saved.id, updatedAt: saved.updatedAt };
    });
    return { id: saved.id, rev };
  },

  "library.addEntry": (ctx, _session, params) => {
    const id = ctx.library.change((db) =>
      db.addEntry(params.libraryId, params.itemId, params.index, params.number),
    );
    return { id, rev: ctx.store.rev };
  },

  "library.updateEntry": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.updateEntry(params.entryId, params.number);
    });
    return { rev: ctx.store.rev };
  },

  "library.removeEntry": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.removeEntry(params.entryId);
    });
    return { rev: ctx.store.rev };
  },

  "library.moveEntry": (ctx, _session, params) => {
    ctx.library.change((db) => {
      db.moveEntry(params.entryId, params.toIndex);
    });
    return { rev: ctx.store.rev };
  },

  "media.list": (ctx, _session, params) => ({ media: ctx.library.db.listMedia(params.kind) }),

  "media.import": async (ctx, session, params) => {
    requireLocal(session);
    return { media: await ctx.library.importMedia(params.path) };
  },

  "playlist.addFromLibrary": (ctx, _session, params) => {
    let id = "";
    const rev = showChange(ctx, (draft) => {
      id = ctx.library.addToShow(draft, params.itemId, params.index);
    });
    return { id, rev };
  },

  "item.refreshFromLibrary": (ctx, _session, params) => ({
    rev: showChange(ctx, (draft) => {
      ctx.library.refreshInShow(draft, params.id);
    }),
  }),
};

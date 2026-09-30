import { ErrorCode, RpcError, type StateDocument } from "@cuelith/protocol";
import {
  goLive,
  previewPosition,
  programPosition,
  pruneDirect,
  setPreview,
} from "../../show/live.js";
import {
  firstPosition,
  isValidPosition,
  nextPosition,
  prevPosition,
  type Position,
} from "../../show/positions.js";
import type { HandlerMap } from "../dispatch.js";

/**
 * Controlla che la slide richiesta esista: voce (o elemento fuori scaletta)
 * mancante = 4040, indice fuori = 4220.
 */
function checkPosition(doc: StateDocument, position: Position): void {
  const exists =
    position.itemId !== undefined
      ? doc.live.direct?.[position.itemId] !== undefined
      : doc.show.playlist.some((e) => e.id === position.entryId);
  if (!exists) {
    throw new RpcError(
      ErrorCode.NotFound,
      position.itemId !== undefined ? "core.error.itemNotFound" : "core.error.entryNotFound",
    );
  }
  if (!isValidPosition(doc, position)) {
    throw new RpcError(ErrorCode.InvalidParameters, "core.error.slideOutOfRange");
  }
}

export const cueHandlers: HandlerMap = {
  "cue.next": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const program = programPosition(draft);
      // Programma vuoto: parte cio' che e' in anteprima, o l'inizio della scaletta.
      const target =
        program === undefined
          ? (previewPosition(draft) ?? firstPosition(draft.show))
          : nextPosition(draft, program);
      if (target === undefined) return;
      // Dopo "pulisci" il cursore e' rimasto: "avanti" mostra la slide successiva.
      goLive(draft, target);
    }),
  }),

  "cue.prev": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const program = programPosition(draft);
      if (program === undefined) return;
      const target = prevPosition(draft, program);
      if (target !== undefined) goLive(draft, target);
    }),
  }),

  "cue.goto": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      checkPosition(draft, params);
      goLive(draft, params);
    }),
  }),

  "cue.take": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const preview = previewPosition(draft);
      if (preview !== undefined) goLive(draft, preview);
    }),
  }),

  "preview.set": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      checkPosition(draft, params);
      setPreview(draft, params);
    }),
  }),

  "layer.clear": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      draft.live.layers[params.layer] = { visible: false };
      pruneDirect(draft);
    }),
  }),

  /**
   * Un elemento della libreria in anteprima o subito in onda, senza scaletta:
   * una copia sta in live.direct finche' e' in programma o in anteprima.
   * Non tocca lo show (niente modifiche da salvare).
   */
  "cue.send": (ctx, _session, params) => {
    const item = ctx.library.directCopy(params.libraryItemId);
    const position = { itemId: item.id, slideIndex: params.slideIndex ?? 0 };
    const rev = ctx.store.update((draft) => {
      draft.live.direct = { ...draft.live.direct, [item.id]: item };
      checkPosition(draft, position);
      if (params.to === "program") goLive(draft, position);
      else setPreview(draft, position);
    });
    return { id: item.id, rev };
  },
};

import { ErrorCode, RpcError, type StateDocument } from "@cuelith/protocol";
import { goLive, previewPosition, programPosition } from "../../show/live.js";
import {
  firstPosition,
  isValidPosition,
  nextPosition,
  prevPosition,
  type Position,
} from "../../show/positions.js";
import type { HandlerMap } from "../dispatch.js";

/** Controlla che la slide richiesta esista: voce mancante = 4040, indice fuori = 4220. */
function checkPosition(doc: StateDocument, position: Position): void {
  if (!doc.show.playlist.some((e) => e.id === position.entryId)) {
    throw new RpcError(ErrorCode.NotFound, "core.error.entryNotFound");
  }
  if (!isValidPosition(doc.show, position)) {
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
          : nextPosition(draft.show, program);
      if (target === undefined) return;
      // Dopo "pulisci" il cursore e' rimasto: "avanti" mostra la slide successiva.
      goLive(draft, target);
    }),
  }),

  "cue.prev": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const program = programPosition(draft);
      if (program === undefined) return;
      const target = prevPosition(draft.show, program);
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
      draft.live.preview = { entryId: params.entryId, slideIndex: params.slideIndex };
    }),
  }),

  "layer.clear": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      draft.live.layers[params.layer] = { visible: false };
    }),
  }),
};

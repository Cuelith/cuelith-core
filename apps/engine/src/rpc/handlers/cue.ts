import {
  ErrorCode,
  RpcError,
  cleanSpans,
  styleRange,
  timerRemaining,
  type StateDocument,
} from "@cuelith/protocol";
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

  // «Solo sfondo» (protocollo 1.17): il testo sparisce da tutte le uscite, lo sfondo resta.
  "live.textHidden": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      if (params.hidden) draft.live.textHidden = true;
      else delete draft.live.textHidden;
    }),
  }),

  // ---- Parole formattate in un testo in modifica (protocollo 1.22, decisione 0022) ----
  // L'editor di un plugin descrive il testo e il tratto selezionato; il plugin annesso della
  // formattazione chiede le modifiche; lo stato le porta a chi scrive. Niente di tutto questo
  // entra nello show: e' solo la conversazione tra i due.
  "richtext.session": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      const length = params.text.length;
      const previous = draft.live.richText;
      const same = previous?.owner === params.owner && previous.field === params.field;
      const spans = cleanSpans(params.text, params.spans);
      draft.live.richText = {
        owner: params.owner,
        field: params.field,
        text: params.text,
        ...(spans.length === 0 ? {} : { spans }),
        selection: {
          start: Math.min(params.selection.start, length),
          end: Math.min(params.selection.end, length),
        },
        ...(params.font === undefined ? {} : { font: params.font }),
        applied: same ? previous.applied : 0,
      };
    }),
  }),
  "richtext.end": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      const current = draft.live.richText;
      // Solo chi ha aperto la sessione la chiude: un altro editor non toglie il testo a questo.
      if (current?.owner === params.owner && current.field === params.field) {
        delete draft.live.richText;
      }
    }),
  }),
  "richtext.apply": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      const current = draft.live.richText;
      if (current === undefined) {
        throw new RpcError(ErrorCode.NotFound, "core.error.richTextNoSession");
      }
      const { start, end } = current.selection;
      if (end <= start) {
        throw new RpcError(ErrorCode.InvalidParameters, "core.error.richTextNoSelection");
      }
      const change = params.change;
      const spans = styleRange(current.text, current.spans, start, end, {
        ...(change.size === undefined ? {} : { size: change.size }),
        ...(change.bold === undefined ? {} : { bold: change.bold }),
        ...(change.italic === undefined ? {} : { italic: change.italic }),
        ...(change.color === undefined ? {} : { color: change.color }),
      });
      if (spans.length === 0) delete current.spans;
      else current.spans = spans;
      current.applied += 1;
    }),
  }),

  // ---- Timer della regia (protocollo 1.7): conto alla rovescia condiviso ----
  "timer.set": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      draft.live.timer = { durationMs: params.durationMs, remainingMs: params.durationMs };
    }),
  }),
  "timer.start": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const timer = draft.live.timer;
      if (timer === undefined || timer.startedAt !== undefined) return;
      timer.startedAt = new Date().toISOString();
    }),
  }),
  "timer.pause": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const timer = draft.live.timer;
      if (timer?.startedAt === undefined) return;
      draft.live.timer = {
        durationMs: timer.durationMs,
        remainingMs: Math.round(timerRemaining(timer)),
      };
    }),
  }),
  "timer.reset": (ctx) => ({
    rev: ctx.store.update((draft) => {
      const timer = draft.live.timer;
      if (timer === undefined) return;
      draft.live.timer = { durationMs: timer.durationMs, remainingMs: timer.durationMs };
    }),
  }),
  "timer.clear": (ctx) => ({
    rev: ctx.store.update((draft) => {
      delete draft.live.timer;
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

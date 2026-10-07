import { isDeepStrictEqual } from "node:util";
import { CORE_LOOK_TEMPLATES, isCoreLookTemplate } from "@cuelith-core/core-looks";
import {
  ErrorCode,
  mediaIdOf,
  newId,
  RpcError,
  type Item,
  type MediaRef,
  type Slide,
  type SlideInput,
  type StateDocument,
} from "@cuelith/protocol";
import type { EngineContext } from "../../context.js";
import { declareItemType } from "../../show/plugins.js";
import { normalizeLive } from "../../show/live.js";
import type { HandlerMap } from "../dispatch.js";

/**
 * Ogni modifica allo show passa da qui: dopo la modifica cursore e anteprima
 * vengono riportati su slide esistenti e lo show risulta da salvare.
 */
function edit(ctx: EngineContext, mutate: (draft: StateDocument) => void): number {
  return ctx.store.update((draft) => {
    mutate(draft);
    normalizeLive(draft);
    if (!ctx.store.read((doc) => isDeepStrictEqual(doc.show, draft.show))) {
      draft.live.dirty = true;
    }
  });
}

const invalid = (key: string): RpcError => new RpcError(ErrorCode.InvalidParameters, key);

function itemOf(draft: StateDocument, id: string): Item {
  const item = draft.show.items[id];
  if (item === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.itemNotFound");
  return item;
}

function slideIndexOf(item: Item, slideId: string): number {
  const index = item.slides.findIndex((s) => s.id === slideId);
  if (index === -1) throw new RpcError(ErrorCode.NotFound, "core.error.slideNotFound");
  return index;
}

function entryIndexOf(draft: StateDocument, entryId: string): number {
  const index = draft.show.playlist.findIndex((e) => e.id === entryId);
  if (index === -1) throw new RpcError(ErrorCode.NotFound, "core.error.entryNotFound");
  return index;
}

function toSlide(input: SlideInput): Slide {
  return { id: newId(), ...input };
}

/** L'arrangiamento puo' usare solo gruppi che qualche slide ha. */
function checkArrangement(item: Item): void {
  if (item.arrangement === undefined) return;
  const groups = new Set(item.slides.map((s) => s.group));
  if (item.arrangement.some((g) => !groups.has(g))) throw invalid("core.error.groupMissing");
}

/** Uno sfondo e' un'immagine gia' nell'archivio media (decisione 0003). */
function checkBackground(ctx: EngineContext, background: MediaRef | null | undefined): void {
  if (background === null || background === undefined) return;
  const id = mediaIdOf(background.uri);
  if (background.kind !== "image" || id === undefined || !ctx.library.db.hasMedia(id)) {
    throw invalid("core.error.backgroundInvalid");
  }
}

/** Gli allegati devono essere file gia' nell'archivio media. */
function checkAttachments(ctx: EngineContext, attachments: Item["attachments"]): void {
  for (const attachment of attachments ?? []) {
    if (!ctx.library.db.hasMedia(attachment.mediaId)) throw invalid("core.error.mediaMissing");
  }
}

function checkIndex(index: number, max: number): void {
  if (index > max) throw invalid("core.error.indexOutOfRange");
}

export const editHandlers: HandlerMap = {
  "item.create": (ctx, _session, params) => {
    const id = newId();
    const rev = edit(ctx, (draft) => {
      declareItemType(draft, params.type, ctx.modules);
      checkAttachments(ctx, params.attachments);
      checkBackground(ctx, params.background);
      for (const slide of params.slides ?? []) checkBackground(ctx, slide.background);
      draft.show.items[id] = {
        id,
        type: params.type,
        title: params.title,
        slides: (params.slides ?? []).map(toSlide),
        meta: params.meta ?? {},
        ...(params.background === undefined ? {} : { background: params.background }),
        ...(params.credits === undefined ? {} : { credits: params.credits }),
        ...(params.tags === undefined ? {} : { tags: params.tags }),
        ...(params.attachments === undefined ? {} : { attachments: params.attachments }),
      };
    });
    return { id, rev };
  },

  "item.update": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const item = itemOf(draft, params.id);
      if (params.title !== undefined) item.title = params.title;
      if (params.meta !== undefined) item.meta = params.meta;
      if (params.arrangement === null) delete item.arrangement;
      else if (params.arrangement !== undefined) item.arrangement = params.arrangement;
      checkBackground(ctx, params.background);
      if (params.background === null) delete item.background;
      else if (params.background !== undefined) item.background = params.background;
      if (params.credits === null) delete item.credits;
      else if (params.credits !== undefined) item.credits = params.credits;
      if (params.textStyle === null) delete item.textStyle;
      else if (params.textStyle !== undefined) item.textStyle = params.textStyle;
      if (params.tags !== undefined) item.tags = params.tags;
      if (params.attachments !== undefined) {
        checkAttachments(ctx, params.attachments);
        item.attachments = params.attachments;
      }
      checkArrangement(item);
    }),
  }),

  "item.delete": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      itemOf(draft, params.id);
      const { [params.id]: _deleted, ...items } = draft.show.items;
      draft.show.items = items;
      draft.show.playlist = draft.show.playlist.filter((e) => e.itemId !== params.id);
    }),
  }),

  "slide.insert": (ctx, _session, params) => {
    const slide = toSlide(params.slide);
    checkBackground(ctx, slide.background);
    const rev = edit(ctx, (draft) => {
      const item = itemOf(draft, params.itemId);
      const index = params.index ?? item.slides.length;
      checkIndex(index, item.slides.length);
      item.slides.splice(index, 0, slide);
    });
    return { id: slide.id, rev };
  },

  "slide.update": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const item = itemOf(draft, params.itemId);
      const slide = item.slides[slideIndexOf(item, params.slideId)];
      if (slide === undefined) return;
      if (params.fields !== undefined) slide.fields = params.fields;
      if (params.group === null) delete slide.group;
      else if (params.group !== undefined) slide.group = params.group;
      if (params.media === null) delete slide.media;
      else if (params.media !== undefined) slide.media = params.media;
      checkBackground(ctx, params.background);
      if (params.background === null) delete slide.background;
      else if (params.background !== undefined) slide.background = params.background;
      checkArrangement(item);
    }),
  }),

  /**
   * Modifica di un look (nome, campi, layer, stile). Lo stile dei look del
   * nucleo si valida col suo schema: un look rotto manderebbe in nero le uscite.
   */
  "look.update": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const look = draft.show.looks[params.id];
      if (look === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.lookNotFound");
      if (params.name !== undefined) look.name = params.name;
      if (params.fields !== undefined) look.fields = params.fields;
      if (params.layers !== undefined) look.layers = params.layers;
      if (params.template !== undefined) look.template = params.template;
      if (params.style !== undefined) look.style = params.style;
      if (isCoreLookTemplate(look.template)) {
        const style = CORE_LOOK_TEMPLATES[look.template].safeParse(look.style);
        if (!style.success) throw invalid("core.error.lookStyleInvalid");
        const image = (style.data.background as { image?: string }).image;
        if (image !== undefined) checkBackground(ctx, { uri: image, kind: "image" });
      }
    }),
  }),

  "slide.delete": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const item = itemOf(draft, params.itemId);
      item.slides.splice(slideIndexOf(item, params.slideId), 1);
      checkArrangement(item);
    }),
  }),

  "slide.move": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const item = itemOf(draft, params.itemId);
      checkIndex(params.toIndex, item.slides.length - 1);
      const [slide] = item.slides.splice(slideIndexOf(item, params.slideId), 1);
      if (slide !== undefined) item.slides.splice(params.toIndex, 0, slide);
    }),
  }),

  "playlist.add": (ctx, _session, params) => {
    const id = newId();
    const rev = edit(ctx, (draft) => {
      itemOf(draft, params.itemId);
      const playlist = draft.show.playlist;
      const index = params.index ?? playlist.length;
      checkIndex(index, playlist.length);
      playlist.splice(index, 0, {
        id,
        itemId: params.itemId,
        ...(params.audience === undefined ? {} : { audience: params.audience }),
      });
    });
    return { id, rev };
  },

  "playlist.remove": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      draft.show.playlist.splice(entryIndexOf(draft, params.entryId), 1);
    }),
  }),

  "playlist.move": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const playlist = draft.show.playlist;
      checkIndex(params.toIndex, playlist.length - 1);
      const [entry] = playlist.splice(entryIndexOf(draft, params.entryId), 1);
      if (entry !== undefined) playlist.splice(params.toIndex, 0, entry);
    }),
  }),

  "playlist.setAudience": (ctx, _session, params) => ({
    rev: edit(ctx, (draft) => {
      const entry = draft.show.playlist[entryIndexOf(draft, params.entryId)];
      if (entry === undefined) return;
      if (params.audience === null) delete entry.audience;
      else entry.audience = params.audience;
    }),
  }),
};

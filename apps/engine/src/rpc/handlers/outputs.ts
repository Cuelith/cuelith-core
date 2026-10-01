import { isDeepStrictEqual } from "node:util";
import {
  DisplayTargetSchema,
  ErrorCode,
  newId,
  RpcError,
  type Feed,
  type OutputConfig,
  type Show,
  type StateDocument,
} from "@cuelith/protocol";
import type { EngineContext } from "../../context.js";
import type { Session } from "../session.js";
import type { HandlerMap } from "../dispatch.js";

const invalid = (key: string): RpcError => new RpcError(ErrorCode.InvalidParameters, key);

function outputOf(draft: StateDocument, id: string): OutputConfig {
  const output = draft.show.outputs[id];
  if (output === undefined) throw new RpcError(ErrorCode.NotFound, "core.error.outputNotFound");
  return output;
}

/** Il feed deve puntare a sorgenti, look, scene e uscite esistenti e compatibili. */
function checkFeed(show: Show, feed: Feed, selfId: string): void {
  if (feed.type === "source") {
    const source = show.sources[feed.sourceId];
    if (source === undefined) throw invalid("core.error.feedInvalid");
    if (feed.lookId !== undefined && show.looks[feed.lookId]?.sourceType !== source.type) {
      throw invalid("core.error.feedInvalid");
    }
  } else if (feed.type === "scene") {
    if (!(feed.sceneId in show.scenes)) throw invalid("core.error.feedInvalid");
  } else if (feed.outputId === selfId || !(feed.outputId in show.outputs)) {
    throw invalid("core.error.feedInvalid");
  }
}

/**
 * Per ora il nucleo sa creare solo uscite su monitor; NDI, diretta e
 * registrazione arrivano dai moduli. Due uscite a schermo intero non
 * possono condividere un monitor: una coprirebbe l'altra.
 */
function checkTarget(
  show: Show,
  output: Pick<OutputConfig, "id" | "kind" | "provider" | "target">,
): void {
  if (output.kind !== "display" || output.provider !== "core") {
    throw invalid("core.error.outputKindUnavailable");
  }
  const target = DisplayTargetSchema.safeParse(output.target);
  if (!target.success) throw invalid("core.error.displayTargetInvalid");
  if (target.data.mode !== "fullscreen") return;
  for (const other of Object.values(show.outputs)) {
    if (other.id === output.id || other.kind !== "display") continue;
    const taken = DisplayTargetSchema.safeParse(other.target);
    if (
      taken.success &&
      taken.data.mode === "fullscreen" &&
      taken.data.displayId === target.data.displayId
    ) {
      throw invalid("core.error.displayInUse");
    }
  }
}

/** Un'uscita con proprietario si comanda solo da quel ruolo o dalla regia (cap. 09). */
function checkOwner(output: OutputConfig, session: Session): void {
  const role = session.role?.id;
  if (output.owner !== undefined && role !== output.owner && role !== "director") {
    throw new RpcError(ErrorCode.OwnedByOtherRole, "core.error.ownedByOtherRole");
  }
}

function configure(ctx: EngineContext, mutate: (draft: StateDocument) => void): number {
  return ctx.store.update((draft) => {
    mutate(draft);
    if (!ctx.store.read((doc) => isDeepStrictEqual(doc.show, draft.show))) draft.live.dirty = true;
  });
}

export const outputHandlers: HandlerMap = {
  "output.create": (ctx, _session, params) => {
    const id = newId();
    const rev = configure(ctx, (draft) => {
      const output: OutputConfig = {
        id,
        name: params.name,
        kind: params.kind,
        provider: params.provider,
        target: params.target,
        format: params.format,
        feed: params.feed,
        ...(params.owner === undefined ? {} : { owner: params.owner }),
      };
      checkTarget(draft.show, output);
      checkFeed(draft.show, output.feed, id);
      draft.show.outputs[id] = output;
      draft.live.outputs[id] = { blackout: false, freeze: false, status: "ok" };
    });
    return { id, rev };
  },

  "output.update": (ctx, _session, params) => ({
    rev: configure(ctx, (draft) => {
      const output = outputOf(draft, params.id);
      if (params.name !== undefined) output.name = params.name;
      if (params.target !== undefined) output.target = params.target;
      if (params.format !== undefined) output.format = params.format;
      if (params.feed !== undefined) output.feed = params.feed;
      if (params.owner === null) delete output.owner;
      else if (params.owner !== undefined) output.owner = params.owner;
      checkTarget(draft.show, output);
      checkFeed(draft.show, output.feed, output.id);
    }),
  }),

  "output.delete": (ctx, _session, params) => ({
    rev: configure(ctx, (draft) => {
      outputOf(draft, params.id);
      const mirrored = Object.values(draft.show.outputs).some(
        (o) => o.feed.type === "mirror" && o.feed.outputId === params.id,
      );
      if (mirrored) throw invalid("core.error.outputMirrored");
      const { [params.id]: _output, ...outputs } = draft.show.outputs;
      const { [params.id]: _live, ...live } = draft.live.outputs;
      const { [params.id]: _scene, ...scenes } = draft.live.activeScene;
      draft.show.outputs = outputs;
      draft.live.outputs = live;
      draft.live.activeScene = scenes;
    }),
  }),

  "output.blackout": (ctx, session, params) => ({
    rev: ctx.store.update((draft) => {
      checkOwner(outputOf(draft, params.outputId), session);
      const live = draft.live.outputs[params.outputId];
      if (live !== undefined) live.blackout = params.on;
    }),
  }),

  /** Messaggio su un'uscita (es. al relatore sul palco); testo vuoto lo toglie. */
  "message.send": (ctx, _session, params) => ({
    rev: ctx.store.update((draft) => {
      outputOf(draft, params.outputId);
      const live = draft.live.outputs[params.outputId];
      if (live === undefined) return;
      const text = params.text.trim();
      if (text === "") delete live.message;
      else live.message = text;
    }),
  }),

  "output.freeze": (ctx, session, params) => ({
    rev: ctx.store.update((draft) => {
      checkOwner(outputOf(draft, params.outputId), session);
      const live = draft.live.outputs[params.outputId];
      if (live !== undefined) live.freeze = params.on;
    }),
  }),
};

import type { CoreEvent, Cursor, StateDocument } from "@cuelith/protocol";

export interface EngineEvent {
  readonly name: string;
  readonly payload?: unknown;
}

/** La parte dello stato da cui nascono gli eventi del nucleo (piccola: si copia a ogni patch). */
export interface EventView {
  readonly showId: string;
  readonly showName: string;
  readonly cursor: Cursor;
  readonly preview: Cursor;
  readonly layers: Readonly<Record<string, boolean>>;
  readonly outputs: Readonly<
    Record<string, { blackout: boolean; freeze: boolean; status: string; error?: string }>
  >;
  readonly dirty: boolean;
  readonly showPath: string | undefined;
  readonly plugins: Readonly<Record<string, string>>;
}

export function eventView(doc: Readonly<StateDocument>): EventView {
  const live = doc.live;
  return {
    showId: doc.show.id,
    showName: doc.show.name,
    cursor: { ...live.cursor },
    preview: { ...live.preview },
    layers: Object.fromEntries(Object.entries(live.layers).map(([id, l]) => [id, l.visible])),
    outputs: Object.fromEntries(
      Object.entries(live.outputs).map(([id, o]) => [
        id,
        {
          blackout: o.blackout,
          freeze: o.freeze,
          status: o.status,
          ...(o.error === undefined ? {} : { error: o.error }),
        },
      ]),
    ),
    dirty: live.dirty,
    showPath: live.showPath,
    plugins: Object.fromEntries(live.plugins.map((p) => [p.id, p.state])),
  };
}

const sameCursor = (a: Cursor, b: Cursor) =>
  a.entryId === b.entryId && a.itemId === b.itemId && a.slideIndex === b.slideIndex;

const cursorPayload = (c: Cursor) => ({
  ...(c.entryId === undefined ? {} : { entryId: c.entryId }),
  ...(c.itemId === undefined ? {} : { itemId: c.itemId }),
  slideIndex: c.slideIndex,
});

/**
 * Eventi del nucleo (CORE_EVENTS) ricavati confrontando lo stato prima e dopo
 * un cambiamento: valgono per qualunque comando li abbia causati, anche quelli
 * aggiunti in futuro, senza che ogni comando debba ricordarsi di emetterli.
 */
export function coreEvents(b: EventView, a: EventView): EngineEvent[] {
  const events: { name: CoreEvent; payload?: unknown }[] = [];

  if (!sameCursor(b.cursor, a.cursor))
    events.push({ name: "core.cue.changed", payload: cursorPayload(a.cursor) });
  if (!sameCursor(b.preview, a.preview))
    events.push({ name: "core.preview.changed", payload: cursorPayload(a.preview) });

  for (const [layer, visible] of Object.entries(a.layers)) {
    if (b.layers[layer] === true && !visible)
      events.push({ name: "core.layer.cleared", payload: { layer } });
  }

  for (const [outputId, output] of Object.entries(a.outputs)) {
    const previous = b.outputs[outputId];
    if ((previous?.blackout ?? false) !== output.blackout)
      events.push({ name: "core.output.blackout", payload: { outputId, on: output.blackout } });
    if ((previous?.freeze ?? false) !== output.freeze)
      events.push({ name: "core.output.freeze", payload: { outputId, on: output.freeze } });
    if (output.status === "error" && previous?.status !== "error")
      events.push({ name: "core.output.error", payload: { outputId, error: output.error } });
  }

  if (b.showId !== a.showId)
    events.push({ name: "core.show.opened", payload: { name: a.showName } });
  else if (b.dirty && !a.dirty && a.showPath !== undefined)
    events.push({ name: "core.show.saved", payload: { path: a.showPath } });

  for (const [pluginId, state] of Object.entries(a.plugins)) {
    if (b.plugins[pluginId] !== state)
      events.push({ name: "core.plugin.stateChanged", payload: { pluginId, state } });
  }
  return events;
}

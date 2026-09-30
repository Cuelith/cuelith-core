import { emptyLayers, newId, type StateDocument } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { sectionTarget } from "../src/station/shortcuts.js";

function song(slideIndex: number): StateDocument {
  const itemId = newId();
  const entryId = newId();
  const slide = (group: string) => ({
    id: newId(),
    group,
    fields: { text: { kind: "text" as const, value: group } },
  });
  return {
    show: {
      schema: 1,
      id: newId(),
      name: "Show",
      playlist: [{ id: entryId, itemId }],
      items: {
        [itemId]: {
          id: itemId,
          type: "core.text",
          title: "Canto",
          slides: [slide("v1"), slide("c1"), slide("v2"), slide("b1")],
          arrangement: ["v1", "c1", "v2", "c1", "b1", "c1"],
          meta: {},
        },
      },
      sources: {},
      looks: {},
      scenes: {},
      outputs: {},
      rules: [],
      plugins: {},
    },
    live: {
      rev: 0,
      cursor: { entryId, slideIndex },
      preview: { slideIndex: 0 },
      layers: emptyLayers(),
      outputs: {},
      activeScene: {},
      clients: [],
      plugins: [],
      dirty: false,
      libraryRev: 0,
    },
  };
}

describe("tasti delle sezioni", () => {
  it("vanno alla prossima occorrenza della sezione nell'ordine di proiezione", () => {
    // v1 c1 v2 c1 b1 c1: dalla prima strofa, C va al primo ritornello.
    expect(sectionTarget(song(0), "c")?.slideIndex).toBe(1);
    expect(sectionTarget(song(1), "c")?.slideIndex).toBe(3);
    expect(sectionTarget(song(2), "b")?.slideIndex).toBe(4);
    // Dopo l'ultima strofa si ricomincia dall'inizio.
    expect(sectionTarget(song(4), "v")?.slideIndex).toBe(0);
  });

  it("niente sezione di quel tipo o niente in onda: nessun salto", () => {
    expect(sectionTarget(song(0), "p")).toBeUndefined();
    const empty = song(0);
    empty.live.cursor = { slideIndex: 0 };
    expect(sectionTarget(empty, "c")).toBeUndefined();
  });
});

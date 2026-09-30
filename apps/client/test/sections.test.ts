import { emptyLayers, newId, type StateDocument } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { sectionStarts, sectionTarget } from "../src/station/shortcuts.js";

function song(
  slideIndex: number,
  shape: { slides: string[]; arrangement?: string[] } = {
    slides: ["v1", "c1", "v2", "b1"],
    arrangement: ["v1", "c1", "v2", "c1", "b1", "c1"],
  },
): StateDocument {
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
          slides: shape.slides.map(slide),
          ...(shape.arrangement === undefined ? {} : { arrangement: shape.arrangement }),
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
  // Sequenza proiettata: v1 c1 v2 c1 b1 c1 -> slide 0 1 2 3 4 5.
  it("vanno all'inizio della prossima occorrenza della sezione", () => {
    expect(sectionTarget(song(0), "c")?.slideIndex).toBe(1);
    expect(sectionTarget(song(1), "c")?.slideIndex).toBe(3);
    expect(sectionTarget(song(2), "b")?.slideIndex).toBe(4);
    expect(sectionTarget(song(0), "v")?.slideIndex).toBe(2);
  });

  it("dopo l'ultima non si torna all'inizio del canto: si ripete l'ultima incontrata", () => {
    expect(sectionTarget(song(4), "v")?.slideIndex).toBe(2);
    expect(sectionTarget(song(5), "c")?.slideIndex).toBe(5);
  });

  it("una sezione di piu' slide si salta tutta, non slide per slide", () => {
    // v1 (2 slide) c1 (2 slide) v2: sequenza v1 v1 c1 c1 v2 c1 c1.
    const doc = song(0, {
      slides: ["v1", "v1", "c1", "c1", "v2"],
      arrangement: ["v1", "c1", "v2", "c1"],
    });
    const [item] = Object.values(doc.show.items);
    if (item === undefined) throw new Error("canto mancante");
    expect(sectionStarts(item)).toEqual([
      { group: "v1", start: 0 },
      { group: "c1", start: 2 },
      { group: "v2", start: 4 },
      { group: "c1", start: 5 },
    ]);
    expect(sectionTarget(doc, "v")?.slideIndex).toBe(4);
    doc.live.cursor = { ...doc.live.cursor, slideIndex: 1 };
    expect(sectionTarget(doc, "v")?.slideIndex).toBe(4);
    expect(sectionTarget(doc, "c")?.slideIndex).toBe(2);
    doc.live.cursor = { ...doc.live.cursor, slideIndex: 3 };
    expect(sectionTarget(doc, "c")?.slideIndex).toBe(5);
  });

  it("senza ordine di proiezione le sezioni seguono le slide", () => {
    const doc = song(1, { slides: ["v1", "v1", "c1", "v2"] });
    expect(sectionTarget(doc, "v")?.slideIndex).toBe(3);
    expect(sectionTarget(doc, "c")?.slideIndex).toBe(2);
  });

  it("niente sezione di quel tipo o niente in onda: nessun salto", () => {
    expect(sectionTarget(song(0), "p")).toBeUndefined();
    const empty = song(0);
    empty.live.cursor = { slideIndex: 0 };
    expect(sectionTarget(empty, "c")).toBeUndefined();
  });
});

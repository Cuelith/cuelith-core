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

  it("dopo l'ultima si riparte dalla prima di quel tipo (in cerchio)", () => {
    expect(sectionTarget(song(4), "v")?.slideIndex).toBe(0);
    expect(sectionTarget(song(5), "c")?.slideIndex).toBe(1);
  });

  it("il canto V1 V2 C1 V3 C1 B1 C1: V e C non si bloccano mai", () => {
    const shape = {
      slides: ["v1", "v2", "v3", "c1", "b1"],
      arrangement: ["v1", "v2", "c1", "v3", "c1", "b1", "c1"],
    };
    const press = (keys: string, start = 0) => {
      const doc = song(start, shape);
      return Array.from(keys, (key) => {
        const target = sectionTarget(doc, key);
        if (target !== undefined) doc.live.cursor = { ...doc.live.cursor, ...target };
        return (target?.slideIndex ?? -1) + 1;
      });
    };
    // Posizioni (da 1): V1=1 V2=2 C1=3 V3=4 C1=5 B1=6 C1=7.
    expect(press("vvvv")).toEqual([2, 4, 1, 2]);
    expect(press("cccc")).toEqual([3, 5, 7, 3]);
    expect(press("vcbc")).toEqual([2, 3, 6, 7]);
  });

  it("niente in onda: si parte dall'elemento in anteprima, dall'inizio", () => {
    const doc = song(0);
    const entryId = doc.live.cursor.entryId;
    doc.live.cursor = { slideIndex: 0 };
    doc.live.preview = { ...(entryId === undefined ? {} : { entryId }), slideIndex: 0 };
    expect(sectionTarget(doc, "v")).toEqual({ entryId, slideIndex: 0 });
    expect(sectionTarget(doc, "c")).toEqual({ entryId, slideIndex: 1 });
  });

  it("funzionano anche su un elemento fuori scaletta", () => {
    const doc = song(0);
    const [item] = Object.values(doc.show.items);
    if (item === undefined) throw new Error("canto mancante");
    doc.live.direct = { [item.id]: item };
    doc.live.cursor = { itemId: item.id, slideIndex: 0 };
    expect(sectionTarget(doc, "c")).toEqual({ itemId: item.id, slideIndex: 1 });
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

  it("niente sezione di quel tipo o niente in onda ne' in anteprima: nessun salto", () => {
    expect(sectionTarget(song(0), "p")).toBeUndefined();
    const empty = song(0);
    empty.live.cursor = { slideIndex: 0 };
    empty.live.preview = { slideIndex: 0 };
    expect(sectionTarget(empty, "c")).toBeUndefined();
  });
});

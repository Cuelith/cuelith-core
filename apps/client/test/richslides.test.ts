import { describe, expect, it } from "vitest";
import { joinSlidesRich, splitSlides, splitSlidesRich } from "../src/station/show.js";

const texts = [
  "uno\n\ndue\n\ntre",
  "  uno  \n \n\n  due\n",
  "solo una slide\ncon due righe",
  "\n\n\na\n\n\n\nb\n\n",
  "",
  "   ",
];

describe("slide con parole formattate", () => {
  it("le slide sono esattamente quelle di sempre, qualunque sia il testo", () => {
    for (const text of texts) {
      expect(splitSlidesRich(text, undefined).map((part) => part.text)).toEqual(splitSlides(text));
    }
  });

  it("ogni slide porta le sue parole, ritagliate e spostate", () => {
    const text = "uno due\n\ntre quattro";
    const parts = splitSlidesRich(text, [
      { start: 4, end: 7, bold: true },
      { start: 13, end: 20, size: 2 },
    ]);
    expect(parts).toEqual([
      { text: "uno due", spans: [{ start: 4, end: 7, bold: true }] },
      { text: "tre quattro", spans: [{ start: 4, end: 11, size: 2 }] },
    ]);
  });

  it("gli spazi tolti ai bordi spostano la formattazione di conseguenza", () => {
    const parts = splitSlidesRich("  ciao mondo  ", [{ start: 7, end: 12, italic: true }]);
    expect(parts).toEqual([{ text: "ciao mondo", spans: [{ start: 5, end: 10, italic: true }] }]);
  });

  it("riunire le slide e dividerle di nuovo non perde niente", () => {
    const slides = [
      {
        id: "a",
        fields: {
          text: {
            kind: "text" as const,
            value: "uno due",
            spans: [{ start: 4, end: 7, bold: true }],
          },
        },
      },
      { id: "b", fields: { text: { kind: "text" as const, value: "tre" } } },
    ];
    const joined = joinSlidesRich(slides);
    expect(joined.text).toBe("uno due\n\ntre");
    expect(splitSlidesRich(joined.text, joined.spans)).toEqual([
      { text: "uno due", spans: [{ start: 4, end: 7, bold: true }] },
      { text: "tre" },
    ]);
  });
});

import { newId, type Item } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { creditsFor, creditsLine } from "../src/credits.js";

const item = (credits: Item["credits"]): Item => ({
  id: newId(),
  type: "core.text",
  title: "Luce del mattino",
  slides: [],
  meta: {},
  ...(credits === undefined ? {} : { credits }),
});

describe("crediti sulle uscite", () => {
  it("compone titolo, autori, copyright e CCLI", () => {
    expect(
      creditsLine("Luce del mattino", {
        authors: [
          { name: "Anna Rossi", role: "words" },
          { name: "Luca Bianchi", role: "music" },
        ],
        copyright: "2024 Edizioni Aurora",
        ccli: "7012345",
        show: "last",
      }),
    ).toBe("Luce del mattino — Anna Rossi, Luca Bianchi · © 2024 Edizioni Aurora · CCLI 7012345");
  });

  it("non raddoppia il simbolo © e salta le parti vuote", () => {
    expect(creditsLine("Canto", { authors: [], copyright: "© Coro", show: "first" })).toBe(
      "Canto · © Coro",
    );
  });

  it("compaiono solo sulla prima o sull'ultima slide, se richiesto", () => {
    const last = item({ authors: [{ name: "Coro", role: "artist" }], show: "last" });
    expect(creditsFor(last, 0, 3)).toBeUndefined();
    expect(creditsFor(last, 2, 3)).toBe("Luce del mattino — Coro");
    const first = item({ authors: [{ name: "Coro", role: "artist" }], show: "first" });
    expect(creditsFor(first, 0, 3)).toBe("Luce del mattino — Coro");
    expect(creditsFor(item({ authors: [], show: "none" }), 0, 1)).toBeUndefined();
    expect(creditsFor(item(undefined), 0, 1)).toBeUndefined();
  });
});

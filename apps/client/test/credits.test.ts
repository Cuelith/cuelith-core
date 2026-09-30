import { CreditsSchema } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import {
  creditsProblems,
  creditsToForm,
  EMPTY_CREDITS,
  formToCredits,
} from "../src/station/credits.js";
import { joinSlides, splitSlides } from "../src/station/show.js";

describe("crediti nel modulo dell'editor", () => {
  it("un modulo vuoto non crea crediti", () => {
    expect(formToCredits(EMPTY_CREDITS)).toBeUndefined();
  });

  it("andata e ritorno senza perdite, spazi tolti, righe vuote ignorate", () => {
    const form = {
      ...EMPTY_CREDITS,
      authors: [
        { name: "  Anna Rossi ", role: "artist" as const },
        { name: "", role: "words" as const },
        { name: "Luca", role: "music" as const },
      ],
      altTitles: "Light of morning\n\n",
      copyright: "© 2024 Editore",
      year: "2024",
      ccli: "7012345",
      show: "last" as const,
    };
    const credits = formToCredits(form);
    expect(CreditsSchema.safeParse(credits).success).toBe(true);
    expect(credits).toEqual({
      authors: [
        { name: "Anna Rossi", role: "artist" },
        { name: "Luca", role: "music" },
      ],
      altTitles: ["Light of morning"],
      copyright: "© 2024 Editore",
      year: 2024,
      ccli: "7012345",
      show: "last",
    });
    expect(formToCredits(creditsToForm(credits))).toEqual(credits);
  });

  it("segnala anno e CCLI non validi", () => {
    expect(creditsProblems({ ...EMPTY_CREDITS, year: "24", ccli: "CCLI 12" })).toEqual([
      "year",
      "ccli",
    ]);
    expect(creditsProblems({ ...EMPTY_CREDITS, year: "2024", ccli: "12" })).toEqual([]);
  });
});

describe("testo -> slide", () => {
  it("una riga vuota separa le slide, anche con spazi o a capo di Windows", () => {
    expect(splitSlides("Uno\r\nriga due\r\n\r\nDue\n  \nTre\n\n\n")).toEqual([
      "Uno\nriga due",
      "Due",
      "Tre",
    ]);
  });

  it("andata e ritorno", () => {
    const text = "Uno\nriga due\n\nDue";
    const slides = splitSlides(text).map((value, i) => ({
      id: String(i),
      fields: { text: { kind: "text" as const, value } },
    }));
    expect(joinSlides(slides)).toBe(text);
  });
});

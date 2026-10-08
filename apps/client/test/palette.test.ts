import { describe, expect, it } from "vitest";
import { normalize, score, search, type PaletteEntry } from "../src/station/palette.js";

const entry = (
  id: string,
  kind: PaletteEntry["kind"],
  title: string,
  extra: Partial<PaletteEntry> = {},
): PaletteEntry => ({ id, kind, title, ...extra });

const entries: PaletteEntry[] = [
  entry("p1", "plugin", "Brani", { subtitle: "Brani e testi" }),
  entry("p2", "plugin", "Bibbia"),
  entry("c1", "command", "Avanti"),
  entry("c2", "command", "Solo sfondo", { keywords: "nascondi testo" }),
  entry("m1", "mode", "Presenta"),
  entry("a1", "app", "Gestisci le uscite…"),
  entry("i1", "item", "Gloria a Dio"),
  entry("i2", "item", "Grande è il Signore"),
];

describe("normalizzazione", () => {
  it("toglie accenti e maiuscole", () => {
    expect(normalize("Città È")).toBe("citta e");
  });
});

describe("punteggio", () => {
  it("l'inizio del titolo vince sull'inizio di una parola, e questa su un pezzo nel mezzo", () => {
    const base = entry("x", "app", "Gestisci le uscite");
    expect(score(base, "ge")).toBe(0);
    expect(score(base, "usc")).toBe(1);
    expect(score(base, "scit")).toBe(2);
  });

  it("sottotitolo e parole chiave contano, ma meno del titolo", () => {
    expect(score(entry("x", "command", "Solo sfondo", { keywords: "nascondi" }), "nasc")).toBe(3);
  });

  it("ogni parola scritta deve trovarsi, in qualsiasi ordine", () => {
    const base = entry("x", "item", "Grande è il Signore");
    expect(score(base, "signore grande")).toBe(0 + 1);
    expect(score(base, "grande dio")).toBeUndefined();
  });

  it("senza accenti si trova lo stesso", () => {
    expect(score(entry("x", "item", "Grande è il Signore"), "e il")).toBeDefined();
    expect(score(entry("x", "app", "Città"), "citta")).toBe(0);
  });
});

describe("ricerca", () => {
  it("senza testo: tutto tranne gli elementi della scaletta, per gruppi", () => {
    const found = search(entries, "").map((e) => e.id);
    expect(found).toEqual(["p1", "p2", "c1", "c2", "m1", "a1"]);
  });

  it("trova anche gli elementi della scaletta, dal migliore", () => {
    expect(search(entries, "g").map((e) => e.id)).toEqual(["a1", "i1", "i2"]);
    expect(search(entries, "dio").map((e) => e.id)).toEqual(["i1"]);
  });

  it("l'inizio del titolo passa avanti anche se e' di un gruppo dopo", () => {
    expect(search(entries, "b")[0]?.id).toBe("p1");
    const mixed = [entry("a", "item", "Brani del culto"), entry("b", "plugin", "Altro Brani")];
    expect(search(mixed, "brani").map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("nessuna corrispondenza: elenco vuoto", () => {
    expect(search(entries, "zzzz")).toEqual([]);
  });

  it("trova per parola chiave", () => {
    expect(search(entries, "nascondi").map((e) => e.id)).toEqual(["c2"]);
  });
});

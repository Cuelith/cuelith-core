import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_STYLE } from "../src/defaults.js";
import { FullscreenStyleSchema, TextOverrideSchema, type TextStyle } from "../src/styles.js";
import {
  checkStyle,
  effectiveTextStyle,
  fitScale,
  renderScale,
  textFits,
  wrapLines,
  type MeasureText,
  type OutputBox,
} from "../src/text.js";

// Misura finta e prevedibile: ogni carattere e' largo 0,5 volte la dimensione (grassetto: 0,6).
const measure: MeasureText = (text, size, weight) =>
  text.length * size * (weight === "bold" ? 0.6 : 0.5);

const base: TextStyle = { ...DEFAULT_ROOM_STYLE.text, size: 80, margin: 0.05 };
const wide: OutputBox = { width: 1920, height: 1080, name: "Sala" };
const old43: OutputBox = { width: 1024, height: 768, name: "Proiettore" };
const portrait: OutputBox = { width: 1080, height: 1920, name: "Verticale" };

describe("compatibilita' degli stili", () => {
  it("uno stile scritto prima dei campi nuovi resta valido e uguale", () => {
    const parsed = FullscreenStyleSchema.parse(DEFAULT_ROOM_STYLE);
    expect(parsed.text).toEqual(DEFAULT_ROOM_STYLE.text);
    expect(parsed.text.fit).toBeUndefined();
    expect(parsed.text.lineHeight).toBeUndefined();
  });

  it("i campi nuovi si accettano nei loro limiti e non altri", () => {
    const ok = {
      ...DEFAULT_ROOM_STYLE,
      text: {
        ...base,
        lineHeight: 1.5,
        weight: "bold",
        uppercase: true,
        fit: { min: 0.6 },
        outline: { width: 4, color: "#000000" },
        shadow: { offset: 3, blur: 5, color: "#111111" },
      },
    };
    expect(FullscreenStyleSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { lineHeight: 3 },
      { weight: "heavy" },
      { fit: { min: 0.1 } },
      { fit: { min: 0.6, extra: 1 } },
      { outline: { width: 30, color: "#000000" } },
      { shadow: { offset: 2, blur: 2 } },
      { colour: "#fff" },
    ]) {
      const text = { ...base, ...bad };
      expect(FullscreenStyleSchema.safeParse({ ...DEFAULT_ROOM_STYLE, text }).success).toBe(false);
    }
    expect(TextOverrideSchema.safeParse({ scale: 1.2, weight: "bold" }).success).toBe(true);
    expect(TextOverrideSchema.safeParse({ scale: 5 }).success).toBe(false);
    expect(TextOverrideSchema.safeParse({ size: 50 }).success).toBe(false);
  });
});

describe("stile effettivo", () => {
  const global: TextStyle = { ...base, size: 120, color: "#FFFF00", weight: "bold" };

  it("senza niente vale lo stile dell'aspetto", () => {
    expect(effectiveTextStyle(base)).toEqual(base);
  });

  it("le modifiche dell'editor si sommano all'aspetto; la dimensione e' una scala", () => {
    const style = effectiveTextStyle(base, undefined, { scale: 1.25, color: "#00FF00" });
    expect(style.size).toBe(100);
    expect(style.color).toBe("#00FF00");
    expect(style.font).toBe(base.font);
    // Cambiare aspetto cambia anche il testo personalizzato in proporzione.
    expect(effectiveTextStyle({ ...base, size: 40 }, undefined, { scale: 1.25 }).size).toBe(50);
  });

  it("lo stile globale sostituisce del tutto l'editor", () => {
    expect(
      effectiveTextStyle(base, global, { scale: 2, color: "#00FF00", uppercase: true }),
    ).toEqual(global);
  });

  it("tolto lo stile globale tornano le modifiche dell'editor, intatte", () => {
    const editor = { scale: 1.1, uppercase: true };
    const withGlobal = effectiveTextStyle(base, global, editor);
    const without = effectiveTextStyle(base, undefined, editor);
    expect(withGlobal).toEqual(global);
    expect(without.uppercase).toBe(true);
    expect(without.size).toBeCloseTo(88, 5);
    expect(editor).toEqual({ scale: 1.1, uppercase: true });
  });

  it("un campo dell'editor non impostato non cancella quello dell'aspetto", () => {
    expect(effectiveTextStyle(base, undefined, { color: undefined, scale: undefined }).color).toBe(
      base.color,
    );
  });

  it("non modifica gli oggetti ricevuti", () => {
    const copy = structuredClone(base);
    effectiveTextStyle(base, undefined, { scale: 1.5 });
    expect(base).toEqual(copy);
  });
});

describe("a capo e spazio", () => {
  it("va a capo agli spazi e rispetta gli a capo del testo", () => {
    const lines = wrapLines("uno due tre quattro cinque", 100, 20, base, measure);
    // 10 px a carattere, 97 utili: 9 caratteri per riga.
    expect(lines).toEqual(["uno due", "tre", "quattro", "cinque"]);
    expect(wrapLines("a\n\nb", 1000, 20, base, measure)).toEqual(["a", "", "b"]);
  });

  it("spezza una parola piu' lunga della riga invece di uscire dai bordi", () => {
    const lines = wrapLines("supercalifragilistichespiralidoso", 100, 20, base, measure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => measure(line, 20, "normal", "display") <= 100)).toBe(true);
    expect(lines.join("")).toBe("supercalifragilistichespiralidoso");
  });

  it("il maiuscolo conta nella misura e il grassetto e' piu' largo", () => {
    expect(wrapLines("ab", 1000, 20, { ...base, uppercase: true }, measure)).toEqual(["AB"]);
    const normal = wrapLines("aaaa bbbb", 100, 20, base, measure);
    const bold = wrapLines("aaaa bbbb", 100, 20, { ...base, weight: "bold" }, measure);
    expect(normal).toEqual(["aaaa bbbb"]);
    expect(bold).toEqual(["aaaa", "bbbb"]);
  });

  it("la stessa dimensione di stile occupa lo stesso spazio relativo su schermi in scala", () => {
    const text = "Vieni su di noi, resta con noi";
    const a = textFits(text, base, wide, measure);
    const b = textFits(text, base, { width: 960, height: 540 }, measure);
    expect(b.lines).toBe(a.lines);
  });

  it("un testo lungo non entra; con piu' interlinea o un carattere piu' grande ancora meno", () => {
    const text = "riga ".repeat(120);
    expect(textFits("Amen", base, wide, measure).fits).toBe(true);
    expect(textFits(text, base, wide, measure).fits).toBe(false);
    const few = "uno due tre quattro cinque sei sette otto";
    expect(textFits(few, base, wide, measure).fits).toBe(true);
    expect(textFits(few, { ...base, lineHeight: 2.5, size: 200 }, wide, measure).fits).toBe(false);
  });

  it("lo spazio riservato in basso (crediti) restringe l'altezza utile", () => {
    const text = "uno\ndue\ntre\nquattro\ncinque\nsei";
    const free = textFits(text, base, wide, measure);
    expect(free.fits).toBe(true);
    expect(textFits(text, base, wide, measure, { reserveBottomPx: 600 }).fits).toBe(false);
  });
});

describe("adattamento", () => {
  const long = "Vieni su di noi Signore, resta con noi per sempre nella gioia";
  const twoLines = `${long}\n${long}`;

  it("1 se entra gia'", () => {
    expect(fitScale(["Amen"], base, wide, measure)).toBe(1);
  });

  it("senza l'opzione, un testo che non entra non si adatta", () => {
    const big = { ...base, size: 300 };
    expect(fitScale([twoLines], big, wide, measure)).toBeUndefined();
  });

  it("con l'opzione, rimpicciolisce il minimo necessario e il risultato entra davvero", () => {
    const style = { ...base, size: 220, fit: { min: 0.2 } };
    const texts = [twoLines, "Amen"];
    const scale = fitScale(texts, style, wide, measure);
    expect(scale).toBeDefined();
    expect(scale ?? 0).toBeLessThan(1);
    expect(scale ?? 0).toBeGreaterThanOrEqual(0.2);
    for (const text of texts)
      expect(textFits(text, style, wide, measure, { scale: scale ?? 1 }).fits).toBe(true);
    // E non si e' rimpicciolito piu' del necessario.
    expect(textFits(twoLines, style, wide, measure, { scale: (scale ?? 1) * 1.03 }).fits).toBe(
      false,
    );
  });

  it("la scala e' una sola per tutte le slide: decide la piu' lunga", () => {
    const style = { ...base, size: 220, fit: { min: 0.2 } };
    const onlyLong = fitScale([twoLines], style, wide, measure);
    const withShort = fitScale([twoLines, "Amen", "Si"], style, wide, measure);
    expect(withShort).toBeCloseTo(onlyLong ?? 0, 5);
  });

  it("se neppure al minimo entra, nessuna scala", () => {
    const style = { ...base, size: 220, fit: { min: 0.95 } };
    expect(fitScale([twoLines], style, wide, measure)).toBeUndefined();
  });
});

describe("righe intere (adattamento acceso)", () => {
  const verse = "Glorioso giorno hai illuminato il mio cuore";
  const slide = `Tu mi hai chiamato e sono corso da Te\n${verse}`;

  it("con l'adattamento le righe del testo non vanno mai a capo da sole", () => {
    const style = { ...base, size: 150, fit: { min: 0.3 } };
    const result = textFits(slide, style, wide, measure);
    expect(result.lines).toBe(2);
  });

  it("senza l'adattamento si va a capo come prima", () => {
    const style = { ...base, size: 150 };
    expect(textFits(slide, style, wide, measure).lines).toBeGreaterThan(2);
  });

  it("la scala fa entrare la riga piu' lunga in una riga sola", () => {
    const style = { ...base, size: 150, fit: { min: 0.3 } };
    const scale = fitScale([slide], style, wide, measure) ?? 0;
    expect(scale).toBeLessThan(1);
    expect(textFits(slide, style, wide, measure, { scale }).lines).toBe(2);
    expect(textFits(slide, style, wide, measure, { scale }).fits).toBe(true);
  });

  it("se neppure al minimo entra, per il disegno si scende ancora: meglio piccolo che spezzato", () => {
    const style = { ...base, size: 150, fit: { min: 0.9 } };
    expect(fitScale([slide], style, wide, measure)).toBeUndefined();
    const scale = renderScale([slide], style, wide, measure);
    expect(scale).toBeLessThan(0.9);
    expect(textFits(slide, style, wide, measure, { scale }).fits).toBe(true);
  });

  it("senza adattamento il disegno usa la dimensione dello stile", () => {
    expect(renderScale([slide], { ...base, size: 150 }, wide, measure)).toBe(1);
  });
});

describe("controllo su tutte le uscite", () => {
  const texts = ["Vieni su di noi, resta con noi", "Luce del mattino nel cuore della sala"];

  it("un testo che entra ovunque e' ok, senza adattare", () => {
    expect(checkStyle(texts, base, [wide, old43, portrait], measure)).toEqual({
      ok: true,
      scale: 1,
      failures: [],
    });
  });

  it("vale il caso peggiore: la uscita stretta decide", () => {
    const style = { ...base, size: 80, fit: { min: 0.3 } };
    const result = checkStyle(texts, style, [wide, portrait], measure);
    expect(result.ok).toBe(true);
    expect(result.scale).toBeLessThan(1);
    // La scala trovata vale per tutte le uscite.
    for (const box of [wide, portrait]) {
      for (const text of texts)
        expect(textFits(text, style, box, measure, { scale: result.scale }).fits).toBe(true);
    }
  });

  it("dice quale uscita e quale slide non vanno, quando non c'e' rimedio", () => {
    const style = { ...base, size: 400, margin: 0.1 };
    const result = checkStyle(
      ["Amen", texts[1] ?? ""],
      style,
      [{ ...portrait, name: "Verticale" }, wide],
      measure,
    );
    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.some((f) => f.output === "Verticale")).toBe(true);
    expect(result.failures.every((f) => f.slide >= 0 && f.slide < 2)).toBe(true);
  });
});

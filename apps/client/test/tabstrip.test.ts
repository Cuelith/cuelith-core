import { describe, expect, it } from "vitest";
import { hiddenEdges, scrollToReveal } from "../src/shell/TabStrip.js";

describe("schede che scorrono", () => {
  it("dice da che lato ci sono schede nascoste", () => {
    expect(hiddenEdges(0, 300, 300)).toEqual({ left: false, right: false });
    expect(hiddenEdges(0, 300, 520)).toEqual({ left: false, right: true });
    expect(hiddenEdges(110, 300, 520)).toEqual({ left: true, right: true });
    expect(hiddenEdges(220, 300, 520)).toEqual({ left: true, right: false });
    // Un pixel o due di scarto dovuto agli arrotondamenti non conta.
    expect(hiddenEdges(1, 300, 301)).toEqual({ left: false, right: false });
  });

  it("porta in vista la scheda attiva solo se serve", () => {
    // Gia' dentro, con margine: non si muove.
    expect(scrollToReveal(100, 180, 0, 300)).toBe(0);
    // Tagliata a destra: scorre quanto basta.
    expect(scrollToReveal(280, 360, 0, 300)).toBe(360 + 28 - 300);
    // Tagliata a sinistra: torna indietro, ma mai sotto zero.
    expect(scrollToReveal(40, 120, 100, 300)).toBe(12);
    expect(scrollToReveal(10, 90, 50, 300)).toBe(0);
  });
});

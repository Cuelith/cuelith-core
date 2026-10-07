import { areaPanelIds, CORE_PANELS, ModeContributionSchema, qualify } from "@cuelith/protocol";
import { describe, expect, it } from "vitest";
import { CORE_MODES, PRESENT_MODE } from "../src/modes/core.js";
import { CORE_PANEL_COMPONENTS } from "../src/panels/core-panels.js";

describe("modalita' del nucleo", () => {
  it.each(CORE_MODES.map((mode) => [mode.qualifiedId, mode] as const))(
    "%s rispetta lo stesso schema delle modalita' dei moduli",
    (_id, mode) => {
      const { qualifiedId, ...contribution } = mode;
      expect(ModeContributionSchema.safeParse(contribution).success).toBe(true);
      expect(qualifiedId).toBe(qualify("core", mode.id));
    },
  );

  it("ogni pannello usato dal nucleo esiste ed e' disegnato", () => {
    for (const mode of CORE_MODES) {
      for (const panel of Object.values(mode.layout.panels).flatMap(areaPanelIds)) {
        expect(CORE_PANELS).toContain(panel);
        expect(CORE_PANEL_COMPONENTS[panel]).toBeDefined();
      }
    }
  });

  it("Presenta: scaletta e librerie a schede | slide | programma, anteprima e sfondi (cap. 04)", () => {
    expect(PRESENT_MODE.layout.panels["playlist"]).toEqual(["core.playlist", "core.library"]);
    expect(PRESENT_MODE.shortcut).toBe("Mod+1");
    expect(PRESENT_MODE.layout.columns).toEqual(["25fr", "40fr", "33fr"]);
    expect(PRESENT_MODE.layout.areas).toEqual([
      ["playlist", "slides", "program"],
      ["playlist", "slides", "preview"],
      ["playlist", "slides", "backgrounds"],
      ["playlist", "slides", "textstyles"],
    ]);
    expect(PRESENT_MODE.layout.panels["backgrounds"]).toBe("core.backgrounds");
    // Gli stili del testo stanno subito sotto gli sfondi (decisione 0015).
    expect(PRESENT_MODE.layout.panels["textstyles"]).toBe("core.textstyles");
  });
});

describe("disposizioni fisse (decisione 0006)", () => {
  it("sono cinque, con scorciatoie Ctrl+1..5 diverse", () => {
    expect(CORE_MODES.map((m) => m.id)).toEqual([
      "present",
      "band",
      "conference",
      "director",
      "compact",
    ]);
    expect(CORE_MODES.map((m) => m.shortcut)).toEqual([
      "Mod+1",
      "Mod+2",
      "Mod+3",
      "Mod+4",
      "Mod+5",
    ]);
  });

  it("in ognuna il programma (cio' che e' in onda) resta sempre visibile, mai in una scheda", () => {
    for (const mode of CORE_MODES) {
      const areas = Object.values(mode.layout.panels);
      expect(areas.some((panels) => panels === "core.program")).toBe(true);
      // La scaletta c'e' sempre: anche le schede dei moduli (es. Canti) hanno un posto.
      expect(areas.some((panels) => areaPanelIds(panels).includes("core.playlist"))).toBe(true);
    }
  });
});

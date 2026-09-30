import type { ModeContribution } from "@cuelith/protocol";

export interface Mode extends ModeContribution {
  /** Id qualificato: "core.present", "cuelith.mode-culto.culto", ... */
  readonly qualifiedId: string;
}

/**
 * Presenta: l'unica modalita' del nucleo (cap. 04). E' dichiarata con lo
 * stesso schema delle modalita' dei moduli, cosi' il nucleo non ha un
 * percorso privilegiato: scaletta, slide, programma grande e anteprima.
 */
export const PRESENT_MODE: Mode = {
  qualifiedId: "core.present",
  id: "present",
  title: "core.mode.present",
  shortcut: "Mod+1",
  layout: {
    columns: ["25fr", "40fr", "33fr"],
    rows: ["auto", "1fr"],
    areas: [
      ["playlist", "slides", "program"],
      ["playlist", "slides", "preview"],
    ],
    panels: {
      playlist: ["core.playlist", "core.library"],
      slides: "core.slides",
      program: "core.program",
      preview: "core.preview",
    },
  },
};

export const CORE_MODES: readonly Mode[] = [PRESENT_MODE];

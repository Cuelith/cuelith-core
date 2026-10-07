import type { ModeContribution } from "@cuelith/protocol";

export interface Mode extends ModeContribution {
  /** Id qualificato: "core.present", "cuelith.mode-culto.culto", ... */
  readonly qualifiedId: string;
}

/**
 * Presenta: l'unica modalita' del nucleo (cap. 04). E' dichiarata con lo
 * stesso schema delle modalita' dei moduli, cosi' il nucleo non ha un
 * percorso privilegiato: scaletta, slide, programma grande, anteprima e,
 * sotto, gli sfondi (miniature delle immagini dell'archivio).
 */
export const PRESENT_MODE: Mode = {
  qualifiedId: "core.present",
  id: "present",
  title: "core.mode.present",
  shortcut: "Mod+1",
  layout: {
    columns: ["25fr", "40fr", "33fr"],
    rows: ["auto", "auto", "1fr", "auto"],
    areas: [
      ["playlist", "slides", "program"],
      ["playlist", "slides", "preview"],
      ["playlist", "slides", "backgrounds"],
      ["playlist", "slides", "textstyles"],
    ],
    panels: {
      playlist: ["core.playlist", "core.library"],
      slides: "core.slides",
      program: "core.program",
      preview: "core.preview",
      backgrounds: "core.backgrounds",
      textstyles: "core.textstyles",
    },
  },
};

/**
 * Band / Canti dal vivo: per chi segue un gruppo che improvvisa. Le sezioni
 * del canto in onda sono grossi pulsanti (anche da tablet), sotto c'e'
 * l'ordine di proiezione; a destra programma, prossima slide e messaggio ai
 * musicisti sul palco.
 */
export const BAND_MODE: Mode = {
  qualifiedId: "core.band",
  id: "band",
  title: "core.mode.band",
  shortcut: "Mod+2",
  layout: {
    columns: ["24fr", "46fr", "30fr"],
    rows: ["auto", "auto", "1fr", "auto"],
    areas: [
      ["setlist", "sections", "program"],
      ["setlist", "sections", "preview"],
      ["setlist", "sections", "stage"],
      ["setlist", "order", "order"],
    ],
    panels: {
      setlist: ["core.playlist", "core.library"],
      sections: "core.sections",
      program: "core.program",
      preview: "core.preview",
      stage: "core.stage",
      order: "core.order",
    },
  },
};

/**
 * Conferenza: relatori e sessioni. Scaletta degli interventi, slide in onda e
 * successiva, note del relatore; a destra il timer (colori del tempo, anche
 * sul monitor del palco) e il messaggio al relatore.
 */
export const CONFERENCE_MODE: Mode = {
  qualifiedId: "core.conference",
  id: "conference",
  title: "core.mode.conference",
  shortcut: "Mod+3",
  layout: {
    columns: ["22fr", "26fr", "26fr", "26fr"],
    rows: ["auto", "1fr"],
    areas: [
      ["agenda", "program", "program", "timer"],
      ["agenda", "preview", "notes", "stage"],
    ],
    panels: {
      agenda: ["core.playlist", "core.library"],
      program: "core.program",
      preview: "core.preview",
      notes: "core.notes",
      timer: "core.timer",
      stage: "core.stage",
    },
  },
};

/**
 * Regia / diretta streaming: come in un mixer video, anteprima a sinistra e
 * programma a destra della stessa grandezza, i comandi in mezzo (TAKE), le
 * slide dell'elemento sotto, la scaletta stretta a sinistra.
 */
export const DIRECTOR_MODE: Mode = {
  qualifiedId: "core.director",
  id: "director",
  title: "core.mode.director",
  shortcut: "Mod+4",
  layout: {
    columns: ["20fr", "36fr", "148px", "36fr"],
    rows: ["auto", "1fr"],
    areas: [
      ["playlist", "preview", "transitions", "program"],
      ["playlist", "slides", "slides", "slides"],
    ],
    panels: {
      playlist: ["core.playlist", "core.library"],
      preview: "core.preview",
      transitions: "core.transitions",
      program: "core.program",
      slides: "core.slides",
    },
  },
};

/**
 * Compatta: portatili piccoli e volontari alle prime armi. Due colonne:
 * a sinistra scaletta, slide e librerie a schede; a destra programma e anteprima.
 */
export const COMPACT_MODE: Mode = {
  qualifiedId: "core.compact",
  id: "compact",
  title: "core.mode.compact",
  shortcut: "Mod+5",
  layout: {
    columns: ["58fr", "42fr"],
    rows: ["auto", "1fr"],
    areas: [
      ["main", "program"],
      ["main", "preview"],
    ],
    panels: {
      main: ["core.playlist", "core.slides", "core.library"],
      program: "core.program",
      preview: "core.preview",
    },
  },
};

export const CORE_MODES: readonly Mode[] = [
  PRESENT_MODE,
  BAND_MODE,
  CONFERENCE_MODE,
  DIRECTOR_MODE,
  COMPACT_MODE,
];

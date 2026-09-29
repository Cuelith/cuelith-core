import { newId, type Look } from "@cuelith/protocol";
import { colors } from "@cuelith/ui";
import type { FullscreenStyle, StageStyle } from "./styles.js";

export const PRESENTATION_SOURCE_TYPE = "core.presentation";

export const DEFAULT_ROOM_STYLE: FullscreenStyle = {
  background: { color: "#000000" },
  text: { font: "display", size: 72, color: colors.fg, align: "center", margin: 0.08 },
  transition: { type: "fade", durationMs: 300 },
};

export const DEFAULT_STAGE_STYLE: StageStyle = {
  background: { color: "#000000" },
  text: { font: "body", size: 64, color: "#FFFFFF", align: "left", margin: 0.05 },
  showNext: true,
  showClock: true,
  transition: { type: "cut", durationMs: 0 },
};

/**
 * I due look con cui nasce ogni show (cap. 07): Sala per proiettore e TV,
 * Palco per i monitor di chi e' sul palco. I nomi arrivano gia' tradotti
 * dal motore, perche' diventano dati dello show modificabili dall'utente.
 */
export function createDefaultLooks(names: { room: string; stage: string }): {
  room: Look;
  stage: Look;
} {
  return {
    room: {
      id: newId(),
      name: names.room,
      sourceType: PRESENTATION_SOURCE_TYPE,
      fields: ["text"],
      layers: ["background", "content", "message", "logo"],
      template: "core.fullscreen",
      style: { ...DEFAULT_ROOM_STYLE },
    },
    stage: {
      id: newId(),
      name: names.stage,
      sourceType: PRESENTATION_SOURCE_TYPE,
      fields: ["text", "chords", "notes"],
      layers: ["content", "message"],
      template: "core.stage",
      style: { ...DEFAULT_STAGE_STYLE },
    },
  };
}

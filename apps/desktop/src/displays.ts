import type { DisplayProvider } from "@cuelith-core/engine";
import { screen } from "electron";

/** Monitor collegati, letti da Electron a ogni richiesta (si possono attaccare a caldo). */
export const electronDisplays: DisplayProvider = {
  list: () => {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display) => ({
      id: String(display.id),
      label: display.label === "" ? `${display.size.width}×${display.size.height}` : display.label,
      primary: display.id === primary,
      bounds: {
        x: Math.round(display.bounds.x),
        y: Math.round(display.bounds.y),
        width: Math.round(display.bounds.width),
        height: Math.round(display.bounds.height),
      },
      scaleFactor: display.scaleFactor,
    }));
  },
};

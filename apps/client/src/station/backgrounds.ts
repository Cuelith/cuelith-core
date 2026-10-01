import { FullscreenStyleSchema, type FullscreenStyle } from "@cuelith-core/core-looks";
import {
  mediaUri,
  mediaUrl,
  slideBackground,
  type Item,
  type Look,
  type MediaRef,
  type Slide,
  type StateDocument,
} from "@cuelith/protocol";
import { useCallback } from "react";
import { useRun } from "./station.js";

// Sfondi (decisione 0003): della slide, dell'elemento, predefinito del look
// Sala. Le anteprime della postazione li mostrano come le uscite.

/** Il look Sala (primo look a tutto schermo valido), con il suo stile. */
export function roomLook(doc: StateDocument): { look: Look; style: FullscreenStyle } | undefined {
  for (const look of Object.values(doc.show.looks)) {
    if (look.template !== "core.fullscreen") continue;
    const style = FullscreenStyleSchema.safeParse(look.style);
    if (style.success) return { look, style: style.data };
  }
  return undefined;
}

/** Indirizzo dello sfondo di una slide: suo, dell'elemento o del look; altrimenti nessuno. */
export function backgroundUrl(
  style: FullscreenStyle | undefined,
  item: Pick<Item, "background"> | undefined,
  slide: Pick<Slide, "background"> | undefined,
): string | undefined {
  const uri = slideBackground(item, slide)?.uri ?? style?.background.image;
  return uri === undefined ? undefined : mediaUrl(uri);
}

/**
 * Fa scegliere un'immagine dal computer del motore e la mette nell'archivio
 * media. Solo dalla postazione locale: le altre non vedono i suoi file.
 */
export function useChooseBackground(): (() => Promise<MediaRef | undefined>) | undefined {
  const run = useRun();
  const desktop = window.cuelithDesktop;
  const choose = useCallback(async (): Promise<MediaRef | undefined> => {
    const [path] = (await desktop?.chooseMediaFiles("image")) ?? [];
    if (path === undefined) return undefined;
    const result = await run("media.import", { path });
    if (result === undefined) return undefined;
    return { uri: mediaUri(result.media.id), kind: "image" };
  }, [desktop, run]);
  return desktop === undefined ? undefined : choose;
}

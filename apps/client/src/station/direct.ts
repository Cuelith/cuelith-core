import { useCallback, useEffect, useRef } from "react";
import { useEngine } from "../engine/react.js";
import { useRun, useStation } from "./station.js";

/**
 * Manda un elemento della libreria in anteprima o subito in onda senza
 * metterlo in scaletta (protocollo 1.5, `cue.send`).
 */
export function useSendDirect(): (libraryItemId: string, to: "preview" | "program") => void {
  const run = useRun();
  return useCallback(
    (libraryItemId: string, to: "preview" | "program") => {
      void run("cue.send", { libraryItemId, to });
    },
    [run],
  );
}

/** L'elemento fuori scaletta da mostrare nella colonna Slide: quello in anteprima, se no quello in onda. */
export function directItemId(live: {
  cursor: { itemId?: string | undefined };
  preview: { itemId?: string | undefined };
}): string | undefined {
  return live.preview.itemId ?? live.cursor.itemId;
}

/**
 * Quando arriva un nuovo elemento fuori scaletta (da questa postazione, da
 * un'altra o da un modulo come Canti) la colonna Slide lo mostra: si toglie
 * la scelta della voce di scaletta.
 */
export function useFollowDirect(): void {
  const { state } = useEngine();
  const { select } = useStation();
  const current = state === undefined ? undefined : directItemId(state.live);
  const previous = useRef(current);
  useEffect(() => {
    if (current !== undefined && current !== previous.current) select(undefined);
    previous.current = current;
  }, [current, select]);
}

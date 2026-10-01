import { useCallback } from "react";
import { useEngine } from "../engine/react.js";
import { slideSequence } from "@cuelith/protocol";
import { itemOfEntry } from "./show.js";
import { useRun, useStation } from "./station.js";
import { showTab } from "./tabs.js";

/**
 * Sceglie una voce della scaletta: ne mostra le slide e mette la prima in
 * anteprima, pronta per "Invio". Se la voce e' gia' in onda l'anteprima non
 * si tocca: contiene gia' la slide successiva.
 */
export function useChooseEntry(): (entryId: string) => void {
  const { state } = useEngine();
  const { select } = useStation();
  const run = useRun();
  return useCallback(
    (entryId: string) => {
      select(entryId);
      // Dove le slide sono una scheda (Compatta), la si mostra.
      showTab("core.slides");
      if (state === undefined) return;
      const live = state.live;
      const onAir = live.layers.content.visible && live.cursor.entryId === entryId;
      const item = itemOfEntry(state, entryId);
      if (onAir || item === undefined || slideSequence(item).length === 0) return;
      void run("preview.set", { entryId, slideIndex: 0 });
    },
    [state, select, run],
  );
}

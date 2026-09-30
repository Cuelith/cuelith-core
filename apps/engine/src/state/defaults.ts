import { createDefaultLooks, PRESENTATION_SOURCE_TYPE } from "@cuelith-core/core-looks";
import { emptyLayers, newId, type LiveState, type Show, type Source } from "@cuelith/protocol";

export interface DefaultShowNames {
  readonly show: string;
  readonly roomLook: string;
  readonly stageLook: string;
}

/**
 * Show con cui parte il motore: la sorgente Presentazione del nucleo e i
 * look Sala e Palco. Nessuna uscita: si aggiungono scegliendo il monitor.
 */
export function createShow(names: DefaultShowNames): Show {
  const presentation: Source = {
    id: newId(),
    type: PRESENTATION_SOURCE_TYPE,
    provider: "core",
    params: {},
  };
  const looks = createDefaultLooks({ room: names.roomLook, stage: names.stageLook });
  return {
    schema: 1,
    id: newId(),
    name: names.show,
    playlist: [],
    items: {},
    sources: { [presentation.id]: presentation },
    looks: { [looks.room.id]: looks.room, [looks.stage.id]: looks.stage },
    scenes: {},
    outputs: {},
    rules: [],
    plugins: {},
  };
}

export function createLiveState(): LiveState {
  return {
    rev: 0,
    cursor: { slideIndex: 0 },
    preview: { slideIndex: 0 },
    layers: emptyLayers(),
    outputs: {},
    activeScene: {},
    clients: [],
    plugins: [],
    dirty: false,
    libraryRev: 0,
  };
}

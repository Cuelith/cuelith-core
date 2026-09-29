import type { DisplayInfo } from "@cuelith/protocol";

/**
 * Monitor collegati al computer del motore. Il desktop lo implementa con le
 * API di Electron; i test con un elenco finto. Cosi' il motore non dipende
 * da Electron e si prova in Node puro.
 */
export interface DisplayProvider {
  list(): DisplayInfo[];
}

export const noDisplays: DisplayProvider = { list: () => [] };

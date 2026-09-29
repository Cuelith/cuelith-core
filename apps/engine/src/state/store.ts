import {
  diffState,
  ErrorCode,
  RpcError,
  StateDocumentSchema,
  type JsonPatchOperation,
  type StateDocument,
} from "@cuelith/protocol";
import type { Logger } from "../log.js";

export type PatchListener = (rev: number, ops: readonly JsonPatchOperation[]) => void;

/**
 * Unica fonte di verita' dello show e dello stato live (cap. 21). Ogni
 * cambiamento passa da update(): si lavora su una copia, la copia viene
 * validata per intero e solo allora sostituisce lo stato e viene
 * distribuita come patch con una rev crescente. Uno stato non valido non
 * puo' quindi mai diventare quello corrente.
 */
export class StateStore {
  #doc: StateDocument;
  readonly #listeners = new Set<PatchListener>();
  readonly #logger: Logger;

  constructor(initial: StateDocument, logger: Logger) {
    const result = StateDocumentSchema.safeParse(initial);
    if (!result.success) throw new Error("Stato iniziale non valido", { cause: result.error });
    this.#doc = structuredClone(initial);
    this.#logger = logger;
  }

  get rev(): number {
    return this.#doc.live.rev;
  }

  /** Copia completa dello stato, per le istantanee inviate ai client. */
  snapshot(): StateDocument {
    return structuredClone(this.#doc);
  }

  /** Lettura senza copia: la funzione non deve modificare cio' che riceve. */
  read<T>(fn: (doc: Readonly<StateDocument>) => T): T {
    return fn(this.#doc);
  }

  /**
   * Applica una modifica. Restituisce la nuova rev, o quella attuale se la
   * modifica non ha cambiato nulla. Lancia RpcError se il risultato non e'
   * valido; in quel caso lo stato resta com'era.
   */
  update(mutate: (draft: StateDocument) => void): number {
    const next = structuredClone(this.#doc);
    mutate(next);
    const ops = diffState(this.#doc, next);
    if (ops.length === 0) return this.#doc.live.rev;

    const result = StateDocumentSchema.safeParse(next);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        message: i.message,
        path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
      }));
      this.#logger.error("modifica rifiutata: lo stato risultante non è valido", issues);
      throw new RpcError(ErrorCode.InternalError, "core.error.internal", { issues });
    }

    const rev = this.#doc.live.rev + 1;
    next.live.rev = rev;
    ops.push({ op: "replace", path: "/live/rev", value: rev });
    this.#doc = next;

    for (const listener of this.#listeners) {
      try {
        listener(rev, ops);
      } catch (error) {
        this.#logger.error("errore in un ascoltatore delle patch", error);
      }
    }
    return rev;
  }

  onPatch(listener: PatchListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

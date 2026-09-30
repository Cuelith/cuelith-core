import type { EngineMethodName, EngineMethodParams, EngineMethodResult } from "@cuelith/protocol";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { EngineCallError } from "@cuelith-core/engine-client";
import { useConnection } from "../engine/react.js";

/** Avviso mostrato all'operatore: chiave di traduzione + parametri. */
export interface Notice {
  readonly id: number;
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;
}

/** Richiesta di apertura dell'editor di testo: nuovo elemento o esistente. */
export type EditorRequest = { readonly mode: "create" } | { readonly mode: "edit"; itemId: string };

/** Risposta alla domanda "salvare le modifiche?". */
export type UnsavedChoice = "save" | "discard" | "cancel";

interface StationContextValue {
  /** Voce della scaletta scelta in questa postazione (non e' stato del motore). */
  readonly selectedEntryId: string | undefined;
  readonly select: (entryId: string | undefined) => void;
  readonly editor: EditorRequest | undefined;
  readonly openEditor: (request: EditorRequest) => void;
  readonly closeEditor: () => void;
  readonly notices: readonly Notice[];
  readonly notify: (key: string, params?: Readonly<Record<string, string>>) => void;
  readonly dismiss: (id: number) => void;
  /** Domanda in corso "salvare le modifiche?", se c'e'. */
  /** Id della domanda in corso: una risposta vale solo per la sua domanda. */
  readonly unsavedQuestion: number | undefined;
  readonly askUnsaved: () => Promise<UnsavedChoice>;
  readonly answerUnsaved: (question: number, choice: UnsavedChoice) => void;
}

const StationContext = createContext<StationContextValue | undefined>(undefined);

let nextNotice = 1;
let nextQuestion = 1;

/** Stato locale della postazione: selezione, editor aperto, avvisi. */
export function StationProvider({ children }: { children: ReactNode }) {
  const [selectedEntryId, setSelected] = useState<string | undefined>();
  const [editor, setEditor] = useState<EditorRequest | undefined>();
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const [unsaved, setUnsaved] = useState<
    { id: number; resolve: (choice: UnsavedChoice) => void } | undefined
  >();

  const askUnsaved = useCallback(
    () =>
      new Promise<UnsavedChoice>((resolve) => {
        setUnsaved({ id: nextQuestion++, resolve });
      }),
    [],
  );
  const answerUnsaved = useCallback(
    (question: number, choice: UnsavedChoice) => {
      // Una chiusura in ritardo della domanda precedente non tocca quella nuova.
      if (unsaved?.id !== question) return;
      unsaved.resolve(choice);
      setUnsaved(undefined);
    },
    [unsaved],
  );

  const dismiss = useCallback((id: number) => {
    setNotices((list) => list.filter((n) => n.id !== id));
  }, []);
  const notify = useCallback((key: string, params: Readonly<Record<string, string>> = {}) => {
    const notice = { id: nextNotice++, key, params };
    setNotices((list) => [...list.slice(-2), notice]);
  }, []);

  const value = useMemo<StationContextValue>(
    () => ({
      selectedEntryId,
      select: setSelected,
      editor,
      openEditor: setEditor,
      closeEditor: () => {
        setEditor(undefined);
      },
      notices,
      notify,
      dismiss,
      unsavedQuestion: unsaved?.id,
      askUnsaved,
      answerUnsaved,
    }),
    [selectedEntryId, editor, notices, notify, dismiss, unsaved, askUnsaved, answerUnsaved],
  );
  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}

export function useStation(): StationContextValue {
  const value = useContext(StationContext);
  if (value === undefined) throw new Error("useStation fuori da StationProvider");
  return value;
}

export type Run = <N extends EngineMethodName>(
  method: N,
  params: EngineMethodParams<N>,
) => Promise<EngineMethodResult<N> | undefined>;

/**
 * Esegue un comando del motore. Se fallisce l'operatore vede l'avviso
 * tradotto e il risultato e' undefined: lo stato mostrato resta quello del
 * motore, che non e' cambiato.
 */
export function useRun(): Run {
  const connection = useConnection();
  const { notify } = useStation();
  return useCallback<Run>(
    async (method, params) => {
      try {
        return await connection.call(method, params);
      } catch (error) {
        if (error instanceof EngineCallError) notify(error.message, error.params);
        else notify("core.error.internal");
        return undefined;
      }
    },
    [connection, notify],
  );
}

import type { Library, LibraryItemSummary } from "@cuelith/protocol";
import { useEffect, useState } from "react";
import { useConnection, useEngine } from "../engine/react.js";

/** Tipo usato per trascinare un elemento di libreria in scaletta. */
export const LIBRARY_ITEM_DRAG = "application/x-cuelith-library-item";

const PAGE = 200;

/** Librerie, rilette a ogni cambio (live.libraryRev). */
export function useLibraries(): readonly Library[] | undefined {
  const connection = useConnection();
  const rev = useEngine().state?.live.libraryRev;
  const [libraries, setLibraries] = useState<readonly Library[] | undefined>();
  useEffect(() => {
    if (rev === undefined) return;
    let cancelled = false;
    connection
      .call("library.list", {})
      .then(({ libraries: list }) => {
        if (!cancelled) setLibraries(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection, rev]);
  return libraries;
}

export function useLibraryTags(): readonly { tag: string; count: number }[] {
  const connection = useConnection();
  const rev = useEngine().state?.live.libraryRev;
  const [tags, setTags] = useState<readonly { tag: string; count: number }[]>([]);
  useEffect(() => {
    if (rev === undefined) return;
    let cancelled = false;
    connection
      .call("library.tags", {})
      .then(({ tags: list }) => {
        if (!cancelled) setTags(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connection, rev]);
  return tags;
}

export interface ItemsQuery {
  readonly libraryId: string | undefined;
  readonly query: string;
  readonly tag: string | undefined;
  /** Quante righe mostrare (si allarga con "mostra altri"). */
  readonly limit: number;
}

export interface ItemsResult {
  readonly items: readonly LibraryItemSummary[];
  readonly total: number;
  readonly loading: boolean;
}

/**
 * Elementi di una libreria (o di tutto l'archivio) con ricerca e tag. La
 * ricerca parte 150 ms dopo l'ultima lettera, per non interrogare a ogni tasto.
 */
export function useLibraryItems(query: ItemsQuery): ItemsResult {
  const connection = useConnection();
  const rev = useEngine().state?.live.libraryRev;
  const [result, setResult] = useState<{
    key: string;
    items: LibraryItemSummary[];
    total: number;
  }>();
  const key = JSON.stringify([query.libraryId, query.query, query.tag, query.limit, rev]);

  useEffect(() => {
    if (rev === undefined) return;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        const text = query.query.trim();
        connection
          .call("library.items", {
            ...(query.libraryId === undefined ? {} : { libraryId: query.libraryId }),
            ...(text === "" ? {} : { query: text }),
            ...(query.tag === undefined ? {} : { tag: query.tag }),
            limit: query.limit,
          })
          .then(({ items, total }) => {
            if (!cancelled) setResult({ key, items, total });
          })
          .catch(() => {
            // Libreria eliminata da un'altra postazione: elenco vuoto, nessun errore.
            if (!cancelled) setResult({ key, items: [], total: 0 });
          });
      },
      query.query === "" ? 0 : 150,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [connection, key, query.libraryId, query.query, query.tag, query.limit, rev]);

  return {
    items: result?.items ?? [],
    total: result?.total ?? 0,
    loading: result?.key !== key,
  };
}

export const LIBRARY_PAGE = PAGE;

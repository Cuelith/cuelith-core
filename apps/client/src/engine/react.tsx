import { translate, type MessageParams } from "@cuelith/protocol";
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EngineConnection, EngineSnapshot } from "@cuelith-core/engine-client";

const ConnectionContext = createContext<EngineConnection | undefined>(undefined);

export function ConnectionProvider({
  connection,
  children,
}: {
  connection: EngineConnection;
  children: ReactNode;
}) {
  return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}

export function useConnection(): EngineConnection {
  const connection = useContext(ConnectionContext);
  if (connection === undefined) throw new Error("useConnection fuori da ConnectionProvider");
  return connection;
}

export function useEngine(): EngineSnapshot {
  const connection = useConnection();
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}

export type Translate = (key: string, params?: MessageParams) => string;

/** Tutti i testi dell'interfaccia passano da qui: le lingue sono moduli. */
export function useT(): Translate {
  const { catalog, lang } = useEngine();
  return useCallback((key, params) => translate(catalog, lang, key, params), [catalog, lang]);
}

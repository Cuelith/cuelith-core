import { newId, type ClientKind, type Role, type RpcMessage } from "@cuelith/protocol";
import type { WebSocket } from "ws";

export type SessionState = "new" | "hello" | "authed";

/** Dove vanno i messaggi di una sessione: un WebSocket o lo stdin di un modulo. */
export interface SessionTransport {
  send(text: string): void;
  close(code: number, reason: string): void;
}

export function socketTransport(socket: WebSocket): SessionTransport {
  return {
    send: (text) => {
      if (socket.readyState === socket.OPEN) socket.send(text);
    },
    close: (code, reason) => {
      socket.close(code, reason);
    },
  };
}

/**
 * Una connessione al motore: postazione o finestra di uscita (WebSocket),
 * oppure il processo di un modulo (stdio, dal passo 9b).
 */
export class Session {
  readonly id = newId();
  state: SessionState = "new";
  kind: ClientKind = "client";
  name = "";
  role: Role | undefined;
  local = false;
  subscribed = false;
  connectedAt: string | undefined;
  /** Postazione abbinata in rete: il suo id stabile (per la revoca). */
  pairedId: string | undefined;
  /** Solo per i processi dei moduli: il modulo e gli eventi che ascolta. */
  pluginId: string | undefined;
  events: ReadonlySet<string> = new Set();
  readonly #transport: SessionTransport;

  constructor(transport: SessionTransport) {
    this.#transport = transport;
  }

  send(message: RpcMessage): void {
    this.#transport.send(JSON.stringify(message));
  }

  close(code: number, reason: string): void {
    this.#transport.close(code, reason);
  }
}

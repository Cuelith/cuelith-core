import { newId, type ClientKind, type Role, type RpcMessage } from "@cuelith/protocol";
import type { WebSocket } from "ws";

export type SessionState = "new" | "hello" | "authed";

/** Una connessione WebSocket di una postazione o di una finestra di uscita. */
export class Session {
  readonly id = newId();
  state: SessionState = "new";
  kind: ClientKind = "client";
  name = "";
  role: Role | undefined;
  local = false;
  subscribed = false;
  connectedAt: string | undefined;
  readonly #socket: WebSocket;

  constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  send(message: RpcMessage): void {
    if (this.#socket.readyState === this.#socket.OPEN) this.#socket.send(JSON.stringify(message));
  }

  close(code: number, reason: string): void {
    this.#socket.close(code, reason);
  }
}

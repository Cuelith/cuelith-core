import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { parseRpcMessage, rpcNotification, RPC_PATH } from "@cuelith/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import type { EngineContext } from "../context.js";
import { dispatch, type HandlerMap } from "./dispatch.js";
import { Session, socketTransport } from "./session.js";

const HEARTBEAT_MS = 10_000;
/** Dimensione massima di un messaggio in arrivo: nessun comando e' cosi' grande. */
const MAX_PAYLOAD = 8 * 1024 * 1024;

/**
 * Una pagina web aperta nel browser dell'operatore non deve poter comandare
 * il motore: si accettano solo connessioni senza Origin (non browser) o con
 * Origin uguale all'indirizzo del motore stesso (la postazione che serve).
 */
function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  const host = request.headers.host;
  return host !== undefined && origin === `http://${host}`;
}

export interface RpcServer {
  readonly sessions: ReadonlySet<Session>;
  close(): Promise<void>;
}

export function attachRpcServer(http: Server, ctx: EngineContext, handlers: HandlerMap): RpcServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const sessions = new Set<Session>();
  const alive = new WeakMap<WebSocket, boolean>();

  http.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== RPC_PATH || !originAllowed(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
  });

  wss.on("connection", (ws: WebSocket) => {
    const session = new Session(socketTransport(ws));
    sessions.add(session);
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));

    // Una richiesta alla volta per sessione: i comandi di una postazione
    // vengono applicati nell'ordine in cui li ha inviati.
    let queue = Promise.resolve();
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const raw = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Buffer.concat(data as Buffer[]).toString("utf8");
      queue = queue
        .then(async () => {
          const parsed = parseRpcMessage(raw);
          if (parsed.kind === "invalid") {
            session.send(parsed.error);
            return;
          }
          if (parsed.kind !== "request") return;
          session.send(await dispatch(parsed.message, session, ctx, handlers));
        })
        .catch((error: unknown) => {
          ctx.logger.error("errore imprevisto gestendo un messaggio", error);
        });
    });

    ws.on("close", () => {
      sessions.delete(session);
      if (session.state !== "authed") return;
      try {
        ctx.store.update((draft) => {
          draft.live.clients = draft.live.clients.filter((c) => c.id !== session.id);
        });
      } catch (error) {
        ctx.logger.error("impossibile togliere la postazione disconnessa dallo stato", error);
      }
    });

    ws.on("error", (error) => {
      ctx.logger.warn("errore su una connessione", error);
    });
  });

  const unsubscribe = ctx.store.onPatch((rev, ops) => {
    const message = rpcNotification("state.patch", { rev, ops });
    for (const session of sessions) if (session.subscribed) session.send(message);
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    sessions,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        unsubscribe();
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => {
          resolve();
        });
      }),
  };
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { EngineConnection, type Credentials } from "@cuelith-core/engine-client";
import { ConnectionProvider } from "./engine/react.js";
import "./styles.css";

declare global {
  interface Window {
    /** Esposto dal preload di Electron solo nelle finestre locali del motore. */
    readonly cuelithDesktop?: {
      readonly getLocalSession: () => Promise<{ name: string; token: string }>;
    };
  }
}

async function credentials(): Promise<Credentials> {
  const desktop = window.cuelithDesktop;
  if (desktop !== undefined) return desktop.getLocalSession();
  // Postazione da browser: il token arriva con l'abbinamento delle postazioni in rete.
  return { name: navigator.userAgent, token: undefined };
}

const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rpc`;
const connection = new EngineConnection(url, credentials);
connection.start();

const root = document.getElementById("root");
if (root === null) throw new Error("#root mancante");
createRoot(root).render(
  <StrictMode>
    <ConnectionProvider connection={connection}>
      <App />
    </ConnectionProvider>
  </StrictMode>,
);

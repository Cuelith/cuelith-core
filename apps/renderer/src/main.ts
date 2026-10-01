import { EngineConnection } from "@cuelith-core/engine-client";
import { describeOutput } from "./frame.js";
import { loadFonts, Painter, type PaintStats } from "./painter.js";
import "./styles.css";

declare global {
  interface Window {
    /** Esposto dal preload di Electron solo nelle finestre locali del motore. */
    readonly cuelithDesktop?: {
      readonly getLocalSession: () => Promise<{ name: string; token: string }>;
    };
    /** Per le prove automatiche: fotogrammi disegnati e pausa piu' lunga. */
    cuelithOutput?: { readonly stats: PaintStats };
  }
}

const outputId = new URLSearchParams(location.search).get("output") ?? "";
const body = document.body;
body.dataset["output"] = outputId;

async function start(): Promise<void> {
  await loadFonts();
  const painter = new Painter();
  const host = document.getElementById("output");
  if (host === null) throw new Error("#output mancante");
  await painter.init(host);
  window.cuelithOutput = { stats: painter.stats };

  const connection = new EngineConnection(`ws://${location.host}/rpc`, async () => {
    const desktop = window.cuelithDesktop;
    if (desktop === undefined) return { name: "output", token: undefined };
    return desktop.getLocalSession();
  });

  // Cio' che l'uscita mostra davvero: si aggiorna a ogni disegno, anche quando
  // uno sfondo arriva dopo lo stato.
  painter.onDrawn = () => {
    body.dataset["text"] = painter.shownText;
    body.dataset["background"] = painter.shownImage;
  };

  const render = () => {
    const { state, lang, status } = connection.getSnapshot();
    body.dataset["connection"] = status.kind;
    // Senza stato (collegamento perso) resta l'ultima immagine valida.
    if (state === undefined) return;
    document.documentElement.lang = lang;
    const view = describeOutput(state, outputId);
    painter.update(view);
    body.dataset["blackout"] = String(view?.blackout ?? false);
    body.dataset["freeze"] = String(view?.freeze ?? false);
    body.dataset["text"] = painter.shownText;
    body.dataset["background"] = painter.shownImage;
    body.dataset["state"] = "ready";
  };
  connection.subscribe(render);
  connection.start();
}

start().catch((error: unknown) => {
  // Mai un messaggio sullo schermo del pubblico: solo nel registro.
  console.error("[cuelith] uscita non avviata", error);
  body.dataset["state"] = "failed";
});

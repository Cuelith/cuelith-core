import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Text, type Ticker } from "pixi.js";
import { formatTimer, timerPhase, timerRemaining } from "@cuelith/protocol";
import type { Frame, OutputView, TextStyle } from "./frame.js";

const FONT: Record<TextStyle["font"], string> = {
  display: "Fraunces Variable",
  body: "Schibsted Grotesk Variable",
  mono: "JetBrains Mono Variable",
};
const MUTED = "#A9ADB4";
const BAND = "#0B0C0E";

/** Font inclusi nel pacchetto: vanno caricati prima di disegnare testo su canvas. */
export async function loadFonts(): Promise<void> {
  await Promise.all(
    Object.values(FONT).map((family) => document.fonts.load(`48px '${family}'`).catch(() => [])),
  );
}

/** Statistiche del disegno: servono alla prova "le uscite non cadono" (passo 10). */
export interface PaintStats {
  frames: number;
  maxGapMs: number;
}

/** Colori del tempo, come sui timer da palco: verde, ambra, rosso. */
const TIMER_COLOR = { ok: "#37D1BF", warning: "#F2B441", danger: "#FF5B3A" } as const;

function clockText(): string {
  return new Date().toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Disegna una Frame su un'uscita. Esegue solo cio' che riceve (cap. 21):
 * dissolvenze del look, blackout (nero sopra tutto) e freeze (l'immagine resta
 * ferma finche' non si sblocca). Nessun messaggio d'errore arriva mai al pubblico.
 */
export class Painter {
  readonly stats: PaintStats = { frames: 0, maxGapMs: 0 };
  readonly #app = new Application();
  readonly #stage = new Container();
  readonly #cover = new Graphics();
  #current: Container | undefined;
  #leaving: Container | undefined;
  #fade = { elapsed: 0, duration: 0 };
  #shown: OutputView | undefined;
  #latest: OutputView | undefined;
  #clock: Text | undefined;
  #clockTimer: ReturnType<typeof setInterval> | undefined;
  #countdown: Text | undefined;
  #countdownTimer: ReturnType<typeof setInterval> | undefined;

  async init(host: HTMLElement): Promise<void> {
    await this.#app.init({
      resizeTo: window,
      background: "#000000",
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio,
      preference: "webgl",
    });
    host.appendChild(this.#app.canvas);
    this.#app.stage.addChild(this.#stage, this.#cover);
    this.#app.ticker.add((ticker) => {
      this.#tick(ticker);
    });
    this.#app.renderer.on("resize", () => {
      if (this.#shown !== undefined) this.#draw(this.#shown, false);
      this.#drawCover();
    });
  }

  /** Nuovo stato dal motore. */
  update(view: OutputView | undefined): void {
    this.#latest = view;
    this.#drawCover();
    // Freeze: l'immagine resta quella di prima (il blackout vale comunque).
    if (view === undefined || view.freeze) return;
    const previous = this.#shown;
    if (
      previous !== undefined &&
      previous.key === view.key &&
      sameFrame(previous.frame, view.frame)
    ) {
      this.#shown = view;
      return;
    }
    const animate = previous !== undefined && previous.key !== view.key;
    this.#draw(view, animate);
  }

  get blackout(): boolean {
    return this.#latest?.blackout ?? false;
  }

  /** Testo attualmente disegnato (per le prove automatiche). */
  get shownText(): string {
    const frame = this.#shown?.frame;
    return frame === undefined || frame.kind === "black" ? "" : (frame.text ?? "");
  }

  #tick(ticker: Ticker): void {
    this.stats.frames++;
    if (this.stats.frames > 1) this.stats.maxGapMs = Math.max(this.stats.maxGapMs, ticker.deltaMS);
    if (this.#leaving === undefined || this.#current === undefined) return;
    this.#fade.elapsed += ticker.deltaMS;
    const t = Math.min(1, this.#fade.elapsed / this.#fade.duration);
    this.#current.alpha = t;
    this.#leaving.alpha = 1 - t;
    if (t >= 1) {
      this.#leaving.destroy({ children: true });
      this.#leaving = undefined;
    }
  }

  #drawCover(): void {
    const { width, height } = this.#app.screen;
    this.#cover.clear().rect(0, 0, width, height).fill("#000000");
    this.#cover.visible = this.blackout;
  }

  #draw(view: OutputView, animate: boolean): void {
    this.#shown = view;
    const next = this.#render(view.frame);
    const fade = animate && view.transition.type === "fade" && view.transition.durationMs > 0;
    this.#leaving?.destroy({ children: true });
    this.#leaving = undefined;
    if (fade && this.#current !== undefined) {
      this.#leaving = this.#current;
      next.alpha = 0;
      this.#fade = { elapsed: 0, duration: view.transition.durationMs };
    } else {
      this.#current?.destroy({ children: true });
    }
    this.#current = next;
    this.#stage.addChild(next);
  }

  #render(frame: Frame): Container {
    const { width: w, height: h } = this.#app.screen;
    const layer = new Container();
    this.#clock = undefined;
    if (this.#clockTimer !== undefined) clearInterval(this.#clockTimer);
    this.#clockTimer = undefined;
    this.#countdown = undefined;
    if (this.#countdownTimer !== undefined) clearInterval(this.#countdownTimer);
    this.#countdownTimer = undefined;
    if (frame.kind === "black") return layer;

    layer.addChild(new Graphics().rect(0, 0, w, h).fill(frame.background));
    const scale = h / 1080;
    const margin = frame.style.margin * Math.min(w, h);
    const size = frame.style.size * scale;
    const textStyle = (fontSize: number, color: string, wrap: number) => ({
      fontFamily: FONT[frame.style.font],
      fontSize,
      fill: color,
      align: frame.style.align,
      wordWrap: true,
      wordWrapWidth: wrap,
      lineHeight: fontSize * 1.25,
    });

    if (frame.kind === "fullscreen") {
      if (frame.text !== undefined) {
        const text = new Text({
          text: frame.text,
          style: textStyle(size, frame.style.color, w - 2 * margin),
        });
        const ax = frame.style.align === "left" ? 0 : frame.style.align === "right" ? 1 : 0.5;
        text.anchor.set(ax, 0.5);
        text.position.set(ax === 0 ? margin : ax === 1 ? w - margin : w / 2, h / 2);
        layer.addChild(text);
      }
    } else {
      if (frame.text !== undefined) {
        const text = new Text({
          text: frame.text,
          style: textStyle(size, frame.style.color, w - 2 * margin),
        });
        text.position.set(margin, margin);
        layer.addChild(text);
      }
      if (frame.next !== undefined) {
        const top = h * 0.66;
        layer.addChild(
          new Graphics().rect(margin, top, w - 2 * margin, Math.max(1, 2 * scale)).fill(MUTED),
        );
        const next = new Text({
          text: frame.next,
          style: textStyle(size * 0.6, MUTED, w - 2 * margin),
        });
        next.position.set(margin, top + margin * 0.5);
        layer.addChild(next);
      }
      if (frame.clock) {
        const clock = new Text({
          text: clockText(),
          style: { fontFamily: FONT.mono, fontSize: 48 * scale, fill: MUTED },
        });
        clock.anchor.set(1, 0);
        clock.position.set(w - margin, margin * 0.5);
        layer.addChild(clock);
        this.#clock = clock;
        this.#clockTimer = setInterval(() => {
          if (this.#clock !== undefined) this.#clock.text = clockText();
        }, 1000);
      }
      const timer = frame.timer;
      if (timer !== undefined) {
        // Timer del relatore: grande, in alto a destra (sotto l'orologio), coi colori del tempo.
        const remaining = timerRemaining(timer);
        const countdown = new Text({
          text: formatTimer(remaining),
          style: {
            fontFamily: FONT.mono,
            fontSize: 110 * scale,
            fontWeight: "700",
            fill: TIMER_COLOR[timerPhase(remaining)],
          },
        });
        countdown.anchor.set(1, 0);
        countdown.position.set(w - margin, margin * 0.5 + (frame.clock ? 60 * scale : 0));
        layer.addChild(countdown);
        this.#countdown = countdown;
        this.#countdownTimer = setInterval(() => {
          if (this.#countdown === undefined) return;
          const left = timerRemaining(timer);
          this.#countdown.text = formatTimer(left);
          this.#countdown.style.fill = TIMER_COLOR[timerPhase(left)];
        }, 250);
      }
    }

    const band = h * 0.12;
    if (frame.kind === "fullscreen" && frame.credits !== undefined) {
      // Crediti in piccolo in basso, sopra l'eventuale fascia dei messaggi.
      const credits = new Text({
        text: frame.credits,
        style: {
          fontFamily: FONT.body,
          fontSize: 26 * scale,
          fill: frame.style.color,
          align: "center",
          wordWrap: true,
          wordWrapWidth: w - 2 * margin,
        },
      });
      credits.alpha = 0.75;
      credits.anchor.set(0.5, 1);
      credits.position.set(
        w / 2,
        h - (frame.message === undefined ? margin * 0.6 : band + margin * 0.3),
      );
      layer.addChild(credits);
    }

    if (frame.message !== undefined) {
      layer.addChild(new Graphics().rect(0, h - band, w, band).fill(BAND));
      const message = new Text({
        text: frame.message,
        style: { fontFamily: FONT.body, fontSize: 44 * scale, fill: "#FFFFFF", align: "center" },
      });
      message.anchor.set(0.5);
      message.position.set(w / 2, h - band / 2);
      layer.addChild(message);
    }
    return layer;
  }
}

function sameFrame(a: Frame, b: Frame): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

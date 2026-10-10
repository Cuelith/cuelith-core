import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Text, Texture, type Ticker } from "pixi.js";
import { GifSource, GifSprite } from "pixi.js/gif";
import {
  canvasMeasure,
  creditsReserve,
  cssFont,
  fontInfo,
  renderScale,
  weightFor,
  type MeasureText,
} from "@cuelith-core/core-looks";
import { formatTimer, timerPhase, timerRemaining } from "@cuelith/protocol";
import type { Frame, OutputView } from "./frame.js";

/** Misura del testo con i caratteri veri, su un canvas che non si vede (creato alla prima richiesta). */
let measureCache: MeasureText | undefined;
function measure(): MeasureText {
  if (measureCache === undefined) {
    const context = document.createElement("canvas").getContext("2d");
    measureCache = canvasMeasure(
      context ?? { font: "", measureText: (text: string) => ({ width: text.length * 20 }) },
    );
  }
  return measureCache;
}

/** Caratteri fissi dell'interfaccia delle uscite (orologio, conto alla rovescia, crediti, avvisi). */
const FONT = {
  body: fontInfo("body").family,
  mono: fontInfo("mono").family,
};
const MUTED = "#A9ADB4";
/** Oltre questo tempo un'immagine di sfondo non blocca piu' il cambio di slide. */
const IMAGE_TIMEOUT_MS = 4000;
const BAND = "#0B0C0E";

/** Font dell'interfaccia delle uscite: vanno caricati prima di disegnare testo su canvas. */
export async function loadFonts(): Promise<void> {
  await Promise.all(
    [cssFont({ font: "body" }, 48), cssFont({ font: "mono", weight: "bold" }, 48)].map((font) =>
      document.fonts.load(font).catch(() => []),
    ),
  );
}

/** Statistiche del disegno: servono alla prova "le uscite non cadono" (passo 10). */
export interface PaintStats {
  frames: number;
  maxGapMs: number;
  /** Fotogrammi arrivati con una pausa oltre 50 ms (contatore delle risorse). */
  lateFrames: number;
}

/** Pausa oltre la quale un fotogramma conta come in ritardo (3 fotogrammi a 60 al secondo). */
const LATE_FRAME_MS = 50;

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
  readonly stats: PaintStats = { frames: 0, maxGapMs: 0, lateFrames: 0 };
  readonly #app = new Application();
  readonly #stage = new Container();
  readonly #cover = new Graphics();
  /** Immagini di sfondo gia' caricate (undefined = non caricabile: si disegna senza). */
  readonly #images = new Map<string, Texture | undefined>();
  /** Sfondi animati (GIF con piu' fotogrammi): la texture sola e' ferma, servono tutti i fotogrammi. */
  readonly #gifs = new Map<string, GifSource>();
  readonly #loading = new Map<string, Promise<void>>();
  /** Cresce a ogni nuovo stato: un'immagine arrivata tardi non sovrascrive uno stato piu' nuovo. */
  #ticket = 0;
  #fonts = new Set<string>();
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
    const ticket = ++this.#ticket;
    // Freeze: l'immagine resta quella di prima (il blackout vale comunque).
    if (view === undefined || view.freeze) return;
    // Il carattere della slide deve essere pronto prima di disegnare e di misurare: altrimenti le
    // righe verrebbero spezzate con la misura di un carattere di ripiego. I gia' usati sono subito pronti.
    if (view.frame.kind === "black") {
      this.#prepare(view, ticket);
      return;
    }
    const font = cssFont(view.frame.style, 48);
    if (this.#fonts.has(font)) {
      this.#prepare(view, ticket);
      return;
    }
    void document.fonts
      .load(font)
      .catch(() => [])
      .then(() => {
        this.#fonts.add(font);
        if (ticket === this.#ticket) this.#prepare(view, ticket);
      });
  }

  #prepare(view: OutputView, ticket: number): void {
    // La prossima slide avra' bisogno di queste immagini: si caricano adesso.
    for (const url of view.preload) void this.#load(url);
    const image = view.frame.kind === "fullscreen" ? view.frame.image : undefined;
    if (image !== undefined && !this.#images.has(image)) {
      // Mai un fotogramma vuoto (decisione 0003): resta cio' che c'e' finche'
      // lo sfondo non e' pronto, poi si cambia tutto insieme.
      void this.#load(image).then(() => {
        if (ticket === this.#ticket) this.#show(view);
      });
      return;
    }
    this.#show(view);
  }

  /** Scarica e decodifica un'immagine di sfondo; se non riesce si disegnera' senza. */
  #load(url: string): Promise<void> {
    if (this.#images.has(url)) return Promise.resolve();
    let loading = this.#loading.get(url);
    if (loading === undefined) {
      loading = Promise.race([
        this.#decode(url),
        new Promise<undefined>((resolve) => setTimeout(resolve, IMAGE_TIMEOUT_MS, undefined)),
      ])
        .catch(() => undefined)
        .then((texture) => {
          this.#images.set(url, texture);
          this.#loading.delete(url);
        });
      this.#loading.set(url, loading);
    }
    return loading;
  }

  /** Legge l'immagine; una GIF con piu' fotogrammi resta animata (la prima immagine fa da texture ferma). */
  async #decode(url: string): Promise<Texture> {
    const bytes = await (await fetch(url)).arrayBuffer();
    const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
    if (String.fromCharCode(...head) === "GIF8") {
      const source = GifSource.from(bytes);
      if (source.totalFrames > 1) {
        this.#gifs.set(url, source);
        return source.textures[0] ?? Texture.EMPTY;
      }
    }
    const image = new Image();
    image.src = url;
    await image.decode();
    return Texture.from(image);
  }

  #show(view: OutputView): void {
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

  /** Chiamata dopo ogni disegno (anche quando uno sfondo finisce di caricarsi). */
  onDrawn: (() => void) | undefined;

  #textInfo = "";

  /** Come e' disegnato il testo (dimensione reale in pixel, peso, maiuscolo): per le prove automatiche. */
  get shownTextStyle(): string {
    return this.#textInfo;
  }

  /** Immagine di sfondo attualmente disegnata, se c'e' (per le prove automatiche). */
  get shownImage(): string {
    const frame = this.#shown?.frame;
    if (frame?.kind !== "fullscreen" || frame.image === undefined) return "";
    return this.#images.get(frame.image) === undefined ? "" : frame.image;
  }

  /** Testo attualmente disegnato (per le prove automatiche). */
  get shownText(): string {
    const frame = this.#shown?.frame;
    return frame === undefined || frame.kind === "black" ? "" : (frame.text ?? "");
  }

  #tick(ticker: Ticker): void {
    this.stats.frames++;
    if (this.stats.frames > 1) {
      this.stats.maxGapMs = Math.max(this.stats.maxGapMs, ticker.deltaMS);
      if (ticker.deltaMS > LATE_FRAME_MS) this.stats.lateFrames++;
    }
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
    this.onDrawn?.();
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
    const texture =
      frame.kind === "fullscreen" && frame.image ? this.#images.get(frame.image) : undefined;
    if (texture !== undefined && frame.kind === "fullscreen") {
      // L'immagine riempie l'uscita senza deformarsi (il di piu' resta fuori).
      const gif = frame.image === undefined ? undefined : this.#gifs.get(frame.image);
      const sprite = gif === undefined ? new Sprite(texture) : new GifSprite({ source: gif });
      // I fotogrammi sono condivisi tra i disegni: distruggere lo sprite non li distrugge.
      if (sprite instanceof GifSprite) {
        sprite.destroy = (): void => {
          GifSprite.prototype.destroy.call(sprite, false);
        };
      }
      const fit = Math.max(w / texture.width, h / texture.height);
      sprite.anchor.set(0.5);
      sprite.scale.set(fit);
      sprite.position.set(w / 2, h / 2);
      layer.addChild(sprite);
      if (frame.dim > 0) {
        layer.addChild(
          new Graphics().rect(0, 0, w, h).fill({ color: "#000000", alpha: frame.dim }),
        );
      }
    }
    const scale = h / 1080;
    const margin = frame.style.margin * Math.min(w, h);
    // Adattamento: se lo stile lo prevede e una slide non entra, tutto l'elemento si rimpicciolisce uguale.
    const fit =
      frame.style.fit === undefined || frame.text === undefined
        ? 1
        : renderScale(
            frame.fitTexts.includes(frame.text) ? frame.fitTexts : [...frame.fitTexts, frame.text],
            frame.style,
            { width: w, height: h },
            measure(),
            frame.kind === "fullscreen" ? creditsReserve(h, frame.credits !== undefined) : 0,
          );
    const size = frame.style.size * scale * fit;
    this.#textInfo = JSON.stringify({
      size: Math.round(size * 10) / 10,
      lineHeight: frame.style.lineHeight ?? 1.25,
      bold: weightFor(fontInfo(frame.style.font), frame.style.weight) >= 600,
      weight: weightFor(fontInfo(frame.style.font), frame.style.weight),
      italic: frame.style.italic === true && fontInfo(frame.style.font).italic,
      letterSpacing: frame.style.letterSpacing ?? 0,
      vAlign: frame.style.vAlign ?? "middle",
      font: frame.style.font,
      uppercase: frame.style.uppercase === true,
      color: frame.style.color,
      outline: frame.style.outline?.width ?? 0,
      shadow: frame.style.shadow?.offset ?? 0,
    });
    const face = fontInfo(frame.style.font);
    const textStyle = (fontSize: number, color: string, wrap: number) => ({
      fontFamily: face.family,
      fontSize,
      fill: color,
      align: frame.style.align,
      fontWeight: String(weightFor(face, frame.style.weight)) as "400",
      fontStyle:
        frame.style.italic === true && face.italic ? ("italic" as const) : ("normal" as const),
      letterSpacing: (frame.style.letterSpacing ?? 0) * fontSize,
      // Con l'adattamento le righe restano intere: si rimpicciolisce, non si spezza.
      wordWrap: frame.style.fit === undefined,
      wordWrapWidth: wrap,
      lineHeight: fontSize * (frame.style.lineHeight ?? 1.25),
      ...(frame.style.outline === undefined || frame.style.outline.width === 0
        ? {}
        : {
            stroke: {
              color: frame.style.outline.color,
              width: frame.style.outline.width * scale * fit,
              join: "round" as const,
            },
          }),
      ...(frame.style.shadow === undefined
        ? {}
        : {
            dropShadow: {
              color: frame.style.shadow.color,
              alpha: 1,
              blur: frame.style.shadow.blur * scale * fit,
              distance: frame.style.shadow.offset * scale * fit,
              angle: Math.PI / 2,
            },
          }),
    });
    const shown = (value: string): string =>
      frame.style.uppercase === true ? value.toUpperCase() : value;

    if (frame.kind === "fullscreen") {
      if (frame.text !== undefined) {
        const text = new Text({
          text: shown(frame.text),
          style: textStyle(size, frame.style.color, w - 2 * margin),
        });
        const ax = frame.style.align === "left" ? 0 : frame.style.align === "right" ? 1 : 0.5;
        // In alto, al centro (come sempre) o in basso, sopra la fascia dei crediti se c'e'.
        const ay = frame.style.vAlign === "top" ? 0 : frame.style.vAlign === "bottom" ? 1 : 0.5;
        const band = creditsReserve(h, frame.credits !== undefined) / 2;
        const y = ay === 0 ? margin : ay === 1 ? h - margin - band : h / 2;
        text.anchor.set(ax, ay);
        text.position.set(ax === 0 ? margin : ax === 1 ? w - margin : w / 2, y);
        layer.addChild(text);
      }
    } else {
      if (frame.text !== undefined) {
        const text = new Text({
          text: shown(frame.text),
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

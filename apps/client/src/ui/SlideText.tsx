import type { FullscreenStyle } from "@cuelith-core/core-looks";
import type { CSSProperties } from "react";

const FONT: Record<FullscreenStyle["text"]["font"], string> = {
  display: "var(--cl-display)",
  body: "var(--cl-body)",
  mono: "var(--cl-mono)",
};

/**
 * Testo di una slide disegnato con lo stile del look, in scala: le misure
 * del look valgono per un'uscita alta 1080 pixel e qui si riportano
 * all'altezza del riquadro (unita' cq del contenitore). Cosi' anteprima,
 * programma e miniature mostrano esattamente l'impaginazione delle uscite.
 */
export function SlideText({
  text,
  style,
  credits,
  background,
  fit = 1,
  hideText = false,
}: {
  text: string;
  /** Fattore di adattamento (decisione 0015): 1 = nessuno. */
  fit?: number | undefined;
  /** «Solo sfondo»: lo sfondo resta, il testo e i crediti no. */
  hideText?: boolean | undefined;
  style: FullscreenStyle | undefined;
  /** Immagine di sfondo (indirizzo sul motore), col velo del look sopra. */
  background?: string | undefined;
  /** Riga dei crediti, in piccolo in basso come sulle uscite. */
  credits?: string | undefined;
}) {
  const css: CSSProperties =
    style === undefined
      ? {}
      : {
          fontFamily: FONT[style.text.font],
          // La dimensione ottica del carattere dipende dai pixel: in un riquadro piccolo le lettere
          // si allargherebbero e il testo uscirebbe dal bordo. Si fissa a quella dell'uscita.
          fontVariationSettings: `"opsz" ${String(
            Math.min(144, Math.max(9, style.text.size * fit)),
          )}`,
          fontOpticalSizing: "none",
          fontSize: `calc(${String(style.text.size * fit)} / 1080 * 100cqh)`,
          color: style.text.color,
          textAlign: style.text.align,
          lineHeight: style.text.lineHeight ?? 1.25,
          fontWeight: style.text.weight === "bold" ? 700 : 400,
          textTransform: style.text.uppercase === true ? "uppercase" : "none",
          padding: `calc(${String(style.text.margin)} * 100cqmin)`,
          ...(style.text.outline === undefined || style.text.outline.width === 0
            ? {}
            : {
                WebkitTextStroke: `calc(${String(style.text.outline.width * fit)} / 1080 * 100cqh) ${style.text.outline.color}`,
                paintOrder: "stroke fill",
              }),
          ...(style.text.shadow === undefined
            ? {}
            : {
                textShadow: `0 calc(${String(style.text.shadow.offset * fit)} / 1080 * 100cqh) calc(${String(style.text.shadow.blur * fit)} / 1080 * 100cqh) ${style.text.shadow.color}`,
              }),
        };
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center ${
        style?.text.fit === undefined ? "whitespace-pre-line" : "whitespace-pre"
      }`}
      style={css}
    >
      {background !== undefined && (
        <span
          data-testid="slide-background"
          data-background={background}
          aria-hidden="true"
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url("${background}")` }}
        />
      )}
      {background !== undefined && (style?.background.dim ?? 0) > 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-black"
          style={{ opacity: style?.background.dim }}
        />
      )}
      {!hideText && <span className="relative w-full">{text}</span>}
      {credits !== undefined && !hideText && (
        <span
          data-testid="credits"
          className="absolute inset-x-0 text-center font-body opacity-75"
          style={{ bottom: "3cqh", fontSize: "calc(26 / 1080 * 100cqh)" }}
        >
          {credits}
        </span>
      )}
    </div>
  );
}

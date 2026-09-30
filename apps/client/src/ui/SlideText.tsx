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
}: {
  text: string;
  style: FullscreenStyle | undefined;
  /** Riga dei crediti, in piccolo in basso come sulle uscite. */
  credits?: string | undefined;
}) {
  const css: CSSProperties =
    style === undefined
      ? {}
      : {
          fontFamily: FONT[style.text.font],
          fontSize: `calc(${String(style.text.size)} / 1080 * 100cqh)`,
          color: style.text.color,
          textAlign: style.text.align,
          padding: `calc(${String(style.text.margin)} * 100cqmin)`,
        };
  return (
    <div
      className="absolute inset-0 flex items-center justify-center leading-[1.25] whitespace-pre-line"
      style={css}
    >
      <span className="w-full">{text}</span>
      {credits !== undefined && (
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

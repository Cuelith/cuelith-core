import type { ReactNode } from "react";

type Tone = "live" | "cue";

const frame: Record<Tone, string> = {
  live: "border-live bg-screen-live",
  cue: "border-cue bg-screen",
};
const tag: Record<Tone, string> = {
  live: "bg-live text-live-ink",
  cue: "bg-cue text-cue-ink",
};

/**
 * Riquadro 16:9 che rappresenta uno schermo: rosso per cio' che e' in onda,
 * ciano per il prossimo (cap. 17). Il contenuto e' un contenitore a misura
 * (unita' cq) in cui i testi si disegnano in scala.
 *
 * - Senza `fill` il riquadro prende tutta la larghezza e l'etichetta sta nell'angolo.
 * - Con `fill` il riquadro riempie lo spazio che gli resta, senza uscirne (ne' in altezza ne'
 *   in larghezza), e l'etichetta sta sopra, con `caption` accanto: niente copre il testo.
 */
export function Screen({
  tone,
  label,
  caption,
  fill = false,
  children,
}: {
  tone: Tone;
  label: string;
  caption?: ReactNode;
  fill?: boolean;
  children?: ReactNode;
}) {
  const content = (
    <div className="absolute inset-0" style={{ containerType: "size" }}>
      {children}
    </div>
  );
  if (!fill) {
    return (
      <div
        className={`relative aspect-video max-w-full overflow-hidden rounded-lg border-2 ${frame[tone]}`}
        data-screen={tone}
      >
        {content}
        <span
          className={`absolute top-2.5 left-2.5 z-10 rounded px-[7px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${tag[tone]}`}
        >
          {label}
        </span>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex min-h-5 items-center gap-2">
        <span
          className={`shrink-0 rounded px-[7px] py-[2px] font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${tag[tone]}`}
        >
          {label}
        </span>
        {caption !== undefined && (
          <span className="min-w-0 flex-1 truncate text-xs">{caption}</span>
        )}
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col justify-center"
        style={{ containerType: "size" }}
      >
        <div
          className={`relative mx-auto shrink-0 overflow-hidden rounded-lg border-2 ${frame[tone]}`}
          style={{ aspectRatio: "16 / 9", width: "min(100cqw, calc(100cqh * 16 / 9))" }}
          data-screen={tone}
        >
          {content}
        </div>
      </div>
    </div>
  );
}

/** Messaggio al centro di uno schermo vuoto. */
export function ScreenEmpty({ text }: { text: string }) {
  return (
    <span className="absolute inset-0 flex items-center justify-center p-4 text-center font-body text-sm text-faint">
      {text}
    </span>
  );
}

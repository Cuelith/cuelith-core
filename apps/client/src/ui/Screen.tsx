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
 * ciano per il prossimo (cap. 17), con l'etichetta nell'angolo. Il contenuto
 * e' un contenitore a misura (unita' cq) in cui i testi si disegnano in scala.
 */
export function Screen({
  tone,
  label,
  children,
}: {
  tone: Tone;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`relative aspect-video max-w-full overflow-hidden rounded-lg border-2 ${frame[tone]}`}
      data-screen={tone}
    >
      <div className="absolute inset-0" style={{ containerType: "size" }}>
        {children}
      </div>
      <span
        className={`absolute top-2.5 left-2.5 z-10 rounded px-[7px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${tag[tone]}`}
      >
        {label}
      </span>
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

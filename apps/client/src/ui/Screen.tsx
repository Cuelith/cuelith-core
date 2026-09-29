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
 * ciano per il prossimo (cap. 17), con l'etichetta nell'angolo.
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
    >
      <span
        className={`absolute top-2.5 left-2.5 z-10 rounded px-[7px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.1em] ${tag[tone]}`}
      >
        {label}
      </span>
      <div className="flex h-full w-full items-center justify-center p-4 text-center font-display">
        {children}
      </div>
    </div>
  );
}

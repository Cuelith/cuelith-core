import type { ButtonHTMLAttributes } from "react";

type Tone = "default" | "live" | "cue" | "primary";

const tones: Record<Tone, string> = {
  default: "border-line-2 text-muted hover:text-fg hover:border-faint",
  live: "border-live/70 text-live-soft hover:bg-live-bg",
  cue: "border-cue/70 text-cue hover:bg-cue-bg",
  primary: "border-fg bg-fg text-bg font-semibold hover:opacity-90",
};

/** Pulsante dell'interfaccia (cap. 17): bordo sottile, colore per significato. */
export function Button({
  tone = "default",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: "sm" | "md" }) {
  return (
    <button
      type={type}
      className={`rounded-md border ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-[13px]"} disabled:pointer-events-none disabled:opacity-40 ${tones[tone]} ${className}`}
      {...props}
    />
  );
}

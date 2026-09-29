import { useEffect } from "react";
import { useRun } from "./station.js";

type CueCommand = "cue.next" | "cue.prev" | "cue.take" | "clear";

/**
 * Tasti della regia, uguali in ogni modalita' e compatibili con i
 * telecomandi da presentazione (che mandano PagSu/PagGiu'):
 * → Spazio PagGiu' = avanti · ← PagSu = indietro · Invio = anteprima in onda · Esc = pulisci.
 */
const KEYS: Readonly<Record<string, CueCommand>> = {
  ArrowRight: "cue.next",
  PageDown: "cue.next",
  " ": "cue.next",
  ArrowLeft: "cue.prev",
  PageUp: "cue.prev",
  Enter: "cue.take",
  Escape: "clear",
};

/**
 * Elemento raggiunto navigando con la tastiera (Tab, frecce), non con un clic.
 * Serve a decidere a chi vanno Spazio e Invio: :focus-visible non basta,
 * perche' Chromium lo attiva appena si preme un tasto qualsiasi.
 */
let keyboardFocused: Element | null = null;
let lastInputWasKeyboard = false;

/** Tasti da lasciare all'elemento che ha il fuoco (scrittura, pulsanti, menu). */
function belongsToFocused(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("input, textarea, select") !== null) return true;
  // Spazio e Invio restano al pulsante solo se ci si e' arrivati con la tastiera:
  // dopo un clic col mouse devono continuare a comandare la regia.
  const activates = event.key === " " || event.key === "Enter";
  const control = target.closest("button, a[href], summary, [role='button']");
  return activates && control !== null && control === keyboardFocused;
}

export function useCueShortcuts(): void {
  const run = useRun();
  useEffect(() => {
    const onPointer = () => {
      lastInputWasKeyboard = false;
    };
    const onAnyKey = () => {
      lastInputWasKeyboard = true;
    };
    const onFocus = (event: FocusEvent) => {
      keyboardFocused =
        lastInputWasKeyboard && event.target instanceof Element ? event.target : null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector("dialog[open]") !== null) return;
      const command = KEYS[event.key];
      if (command === undefined || belongsToFocused(event)) return;
      event.preventDefault();
      if (command === "clear") void run("layer.clear", { layer: "content" });
      else void run(command, {});
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onAnyKey, true);
    window.addEventListener("focusin", onFocus, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onAnyKey, true);
      window.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [run]);
}

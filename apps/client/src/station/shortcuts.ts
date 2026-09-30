import { slideSequence, type StateDocument } from "@cuelith/protocol";
import { useEffect, useRef } from "react";
import { useEngine } from "../engine/react.js";
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

/**
 * Tasti delle sezioni (come in OpenLP): con in onda un elemento a gruppi (un
 * canto), V C P B I E O vanno alla prossima strofa, ritornello, pre-ritornello,
 * bridge, intro, finale o altro. Si ricomincia dall'inizio se non ce n'e' dopo.
 */
const SECTION_KEYS = new Set(["v", "c", "p", "b", "i", "e", "o"]);

export function sectionTarget(
  doc: StateDocument,
  letter: string,
): { entryId: string; slideIndex: number } | undefined {
  const { cursor } = doc.live;
  if (cursor.entryId === undefined) return undefined;
  const entryId = cursor.entryId;
  const entry = doc.show.playlist.find((e) => e.id === entryId);
  const item = entry === undefined ? undefined : doc.show.items[entry.itemId];
  if (item === undefined) return undefined;
  const sequence = slideSequence(item);
  for (let step = 1; step <= sequence.length; step++) {
    const index = (cursor.slideIndex + step) % sequence.length;
    if (sequence[index]?.group?.toLowerCase().startsWith(letter) === true) {
      return { entryId, slideIndex: index };
    }
  }
  return undefined;
}

export function useCueShortcuts(): void {
  const run = useRun();
  const { state } = useEngine();
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
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
      const letter = event.key.toLowerCase();
      if (SECTION_KEYS.has(letter) && !belongsToFocused(event) && latest.current !== undefined) {
        const target = sectionTarget(latest.current, letter);
        if (target !== undefined) {
          event.preventDefault();
          void run("cue.goto", target);
          return;
        }
      }
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

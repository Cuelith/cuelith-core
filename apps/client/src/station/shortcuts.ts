import { cursorItem, slideSequence, type Position, type StateDocument } from "@cuelith/protocol";
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
 * Tasti delle sezioni, con in onda un elemento a gruppi (un
 * canto). Si ragiona per sezioni nell'ordine di proiezione, non per slide:
 * - V C P B I E O = inizio della prossima Verse, Chorus, Pre-Chorus, Bridge,
 *   Intro, Ending, Others nell'ordine di proiezione; dopo l'ultima si riparte
 *   dalla prima di quel tipo (in cerchio: il tasto non si blocca mai).
 * - Niente in onda (o non ancora: tasto premuto subito dopo Invio): si parte
 *   dall'elemento in anteprima, dall'inizio.
 * Niente "lettera + numero": la lettera salterebbe subito e il numero dopo,
 * con un lampo della sezione sbagliata in onda. Per una sezione precisa si
 * clicca la sua slide.
 */
const SECTION_KEYS = new Set(["v", "c", "p", "b", "i", "e", "o"]);

/** Dove comincia ogni sezione nella sequenza proiettata (una ripetizione e' una nuova occorrenza). */
export function sectionStarts(
  item: Parameters<typeof slideSequence>[0],
): { group: string; start: number }[] {
  const starts: { group: string; start: number }[] = [];
  if (item.arrangement !== undefined) {
    let index = 0;
    for (const group of item.arrangement) {
      const count = item.slides.filter((s) => s.group === group).length;
      if (count > 0) starts.push({ group, start: index });
      index += count;
    }
    return starts;
  }
  item.slides.forEach((slide, index) => {
    if (slide.group !== undefined && slide.group !== item.slides[index - 1]?.group) {
      starts.push({ group: slide.group, start: index });
    }
  });
  return starts;
}

export function sectionTarget(doc: StateDocument, letter: string): Position | undefined {
  const { cursor, preview } = doc.live;
  const hasProgram = cursor.entryId !== undefined || cursor.itemId !== undefined;
  const base = hasProgram ? cursor : preview;
  const item = cursorItem(doc, base);
  if (item === undefined) return undefined;
  const from = hasProgram ? cursor.slideIndex : -1;
  const matches = sectionStarts(item).filter(({ group }) => group.toLowerCase().startsWith(letter));
  const target = matches.find(({ start }) => start > from) ?? matches[0];
  if (target === undefined) return undefined;
  return base.itemId !== undefined
    ? { itemId: base.itemId, slideIndex: target.start }
    : base.entryId !== undefined
      ? { entryId: base.entryId, slideIndex: target.start }
      : undefined;
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
      const doc = latest.current;
      if (SECTION_KEYS.has(letter) && doc !== undefined && !belongsToFocused(event)) {
        const target = sectionTarget(doc, letter);
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

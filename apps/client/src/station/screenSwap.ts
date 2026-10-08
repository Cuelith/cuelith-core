import { useCallback, useSyncExternalStore } from "react";

// Dimensioni di Programma e Anteprima in «Presenta»: di solito l'anteprima e' la piu' grande
// (si prepara); in diretta puo' servire il contrario. E' una preferenza di questa postazione.

const KEY = "cuelith.screens.swapped";
const CHANGED = "cuelith:screens-swapped";
let memory = false;

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return memory;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Vero se il Programma e' il riquadro grande e l'Anteprima il piccolo. */
export function useScreensSwapped(): readonly [boolean, () => void] {
  const swapped = useSyncExternalStore(subscribe, read);
  const toggle = useCallback(() => {
    const next = !read();
    memory = next;
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Vale comunque finche' la finestra resta aperta.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [swapped, toggle];
}

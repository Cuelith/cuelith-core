import { createContext } from "react";

/** Disposizione in uso: alcuni pannelli si adattano (es. l'anteprima grande in Regia). */
export const CurrentModeContext = createContext<string>("core.present");

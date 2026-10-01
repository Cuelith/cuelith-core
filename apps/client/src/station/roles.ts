import { BUILTIN_ROLES, type Scope } from "@cuelith/protocol";
import { useEngine } from "../engine/react.js";

/**
 * Vero se il ruolo di questa postazione puo' usare i comandi di quell'ambito
 * (cap. 9): l'interfaccia nasconde cio' che il motore rifiuterebbe comunque.
 */
export function useCan(scope: Scope): boolean {
  const { role } = useEngine();
  if (role === undefined || !Object.hasOwn(BUILTIN_ROLES, role)) return false;
  const scopes: readonly Scope[] = BUILTIN_ROLES[role as keyof typeof BUILTIN_ROLES].scopes;
  return scopes.includes(scope);
}

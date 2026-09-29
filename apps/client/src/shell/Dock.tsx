import { useT } from "../engine/react.js";

/**
 * Dock dei moduli (cap. 04): un'icona per ogni modulo con pannelli e, in
 * fondo, il "+" che apre il gestore moduli. Col nucleo nudo c'e' solo il "+".
 */
export function Dock({ onManageModules }: { onManageModules: () => void }) {
  const t = useT();
  return (
    <nav
      aria-label={t("core.dock.label")}
      className="flex flex-col items-center gap-2 border-r border-line py-2.5"
    >
      <button
        type="button"
        onClick={onManageModules}
        aria-label={t("core.dock.addModule")}
        title={t("core.dock.addModule")}
        className="grid h-8 w-8 place-items-center rounded-lg border border-dashed border-faint text-lg leading-none text-muted hover:border-muted hover:text-fg"
      >
        +
      </button>
    </nav>
  );
}

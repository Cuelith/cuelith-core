import { createContext, useContext, useId, type ReactNode } from "react";

/** Come si presenta un pannello nel suo contenitore: dentro una scheda il nome e' gia' sulla scheda. */
export const PanelChrome = createContext<{ labelHidden: boolean }>({ labelHidden: false });

/**
 * Riquadro di un pannello: etichetta in maiuscoletto (cap. 17) e contenuto.
 * Con `labelHidden` (o dentro una scheda) l'etichetta resta solo per i
 * lettori di schermo; le azioni restano visibili.
 */
export function Panel({
  label,
  children,
  actions,
  labelHidden = false,
  tight = false,
}: {
  /** Meno spazio sopra: per i pannelli impilati sotto un altro (anteprima sotto il programma). */
  tight?: boolean;
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  labelHidden?: boolean;
}) {
  const id = useId();
  const chrome = useContext(PanelChrome);
  const hidden = labelHidden || chrome.labelHidden;
  const onlyActions = hidden && actions !== undefined;
  return (
    <section
      aria-labelledby={id}
      className={`flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 p-3 ${tight ? "pt-0" : ""}`}
    >
      <header
        className={
          hidden && !onlyActions ? "sr-only" : "flex min-h-6 items-center justify-between gap-2"
        }
      >
        <h2
          id={id}
          className={
            hidden ? "sr-only" : "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted"
          }
        >
          {label}
        </h2>
        {onlyActions && <span />}
        {actions}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint !== undefined && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

import { useId, type ReactNode } from "react";

/**
 * Riquadro di un pannello: etichetta in maiuscoletto (cap. 17) e contenuto.
 * Con `labelHidden` l'etichetta resta solo per i lettori di schermo, quando il
 * contenuto porta gia' la sua (programma e anteprima hanno il tag sullo schermo).
 */
export function Panel({
  label,
  children,
  actions,
  labelHidden = false,
}: {
  label: string;
  children: ReactNode;
  actions?: ReactNode;
  labelHidden?: boolean;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-h-0 min-w-0 flex-col gap-2.5 p-3">
      <header
        className={labelHidden ? "sr-only" : "flex min-h-6 items-center justify-between gap-2"}
      >
        <h2 id={id} className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          {label}
        </h2>
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

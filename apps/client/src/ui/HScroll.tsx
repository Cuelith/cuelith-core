import { useRef, type ReactNode } from "react";

/**
 * Fila che scorre solo di lato (mai in verticale): la rotella del mouse la sposta a destra
 * e a sinistra, e col trackpad o il dito si trascina. Per righe di miniature e di pulsanti.
 */
export function HScroll({
  children,
  label,
  role,
  className = "",
}: {
  children: ReactNode;
  label: string;
  role?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role={role}
      aria-label={label}
      onWheel={(event) => {
        const row = ref.current;
        // Solo la rotella "verticale": un gesto gia' orizzontale lo gestisce il browser.
        if (row === null || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        row.scrollLeft += event.deltaY;
      }}
      className={`flex flex-nowrap items-center gap-1.5 overflow-x-auto overflow-y-hidden pb-1 ${className}`}
    >
      {children}
    </div>
  );
}

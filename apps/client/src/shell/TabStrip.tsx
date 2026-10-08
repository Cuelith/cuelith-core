import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../engine/react.js";
import { MenuButton } from "../ui/Menu.js";

/** Quanto resta da scorrere a sinistra e a destra (px); sotto la soglia vale come "niente". */
export function hiddenEdges(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): { left: boolean; right: boolean } {
  const slack = 2;
  return {
    left: scrollLeft > slack,
    right: scrollLeft + clientWidth < scrollWidth - slack,
  };
}

/** Quanto scorrere perche' la scheda sia tutta in vista (con un po' di margine), o 0 se lo e' gia'. */
export function scrollToReveal(
  tabLeft: number,
  tabRight: number,
  scrollLeft: number,
  clientWidth: number,
  margin = 28,
): number {
  if (tabLeft - margin < scrollLeft) return Math.max(0, tabLeft - margin);
  if (tabRight + margin > scrollLeft + clientWidth) return tabRight + margin - clientWidth;
  return scrollLeft;
}

interface TabStripProps {
  readonly panelIds: readonly string[];
  readonly active: string;
  readonly baseId: string;
  readonly title: (panelId: string) => string;
  readonly onChoose: (panelId: string) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  /** Schede che si possono chiudere (quelle aperte dalla ricerca e non fissate). */
  readonly closable?: ReadonlySet<string>;
  readonly onClose?: (panelId: string) => void;
  /** In fondo alla riga, fuori dallo scorrimento (es. l'ingranaggio del plugin attivo). */
  readonly trailing?: ReactNode;
}

/**
 * Le schede di un'area su una sola riga che non cambia mai altezza: se non ci
 * stanno tutte la riga scorre (rotellina, frecce, tastiera), i bordi con altre
 * schede nascoste sfumano, la scheda attiva si porta da sola in vista e un
 * pulsante apre l'elenco completo.
 */
export function TabStrip({
  panelIds,
  active,
  baseId,
  title,
  onChoose,
  onKeyDown,
  closable,
  onClose,
  trailing,
}: TabStripProps) {
  const t = useT();
  const strip = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = () => {
    const el = strip.current;
    if (el !== null) setEdges(hiddenEdges(el.scrollLeft, el.clientWidth, el.scrollWidth));
  };

  useEffect(() => {
    const el = strip.current;
    if (el === null) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => {
      observer.disconnect();
    };
  }, [panelIds]);

  // La scheda attiva resta in vista, anche quando la si sceglie da tastiera o da menu.
  useEffect(() => {
    const el = strip.current;
    const tab = document.getElementById(`${baseId}-${active}`);
    if (el === null || tab === null) return;
    const target = scrollToReveal(
      tab.offsetLeft,
      tab.offsetLeft + tab.offsetWidth,
      el.scrollLeft,
      el.clientWidth,
    );
    if (target !== el.scrollLeft) el.scrollTo({ left: target, behavior: "smooth" });
  }, [active, baseId, panelIds]);

  const scrollBy = (direction: 1 | -1) => {
    const el = strip.current;
    el?.scrollBy({ left: direction * Math.max(80, el.clientWidth * 0.6), behavior: "smooth" });
  };

  const overflowing = edges.left || edges.right;
  const arrow =
    "flex h-6 w-5 shrink-0 items-center justify-center text-muted hover:text-fg disabled:opacity-30";

  return (
    <div className="flex shrink-0 items-start border-b border-line pl-1 pr-1 pt-2.5">
      {overflowing && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("core.tabs.scrollLeft")}
          disabled={!edges.left}
          onClick={() => {
            scrollBy(-1);
          }}
          className={arrow}
        >
          ‹
        </button>
      )}
      <div
        ref={strip}
        role="tablist"
        onKeyDown={onKeyDown}
        onScroll={measure}
        // La rotellina verticale muove la riga di lato (non c'e' altro da scorrere qui).
        onWheel={(event) => {
          const el = strip.current;
          if (el === null || event.deltaX !== 0 || event.deltaY === 0) return;
          el.scrollLeft += event.deltaY;
        }}
        style={{
          scrollbarWidth: "none",
          maskImage: `linear-gradient(to right, ${edges.left ? "transparent 0, #000 22px" : "#000 0"}, ${edges.right ? "#000 calc(100% - 22px), transparent 100%" : "#000 100%"})`,
        }}
        className="flex min-w-0 flex-1 gap-4 overflow-x-auto px-2 [&::-webkit-scrollbar]:hidden"
      >
        {panelIds.map((panelId) => {
          const selected = panelId === active;
          const canClose = closable?.has(panelId) === true && onClose !== undefined;
          return (
            <span key={panelId} className="flex shrink-0 items-start gap-1">
              <button
                id={`${baseId}-${panelId}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  onChoose(panelId);
                }}
                // Trascinando qualcosa sopra una scheda la si apre: cosi' un elemento
                // delle Librerie si porta nella Scaletta anche se stanno nella stessa area.
                onDragEnter={() => {
                  if (!selected) onChoose(panelId);
                }}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                  selected ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {title(panelId)}
              </button>
              {canClose && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t("core.tabs.close", { name: title(panelId) })}
                  title={t("core.tabs.close", { name: title(panelId) })}
                  onClick={() => {
                    onClose(panelId);
                  }}
                  className="-mt-0.5 flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-faint hover:bg-bg-3 hover:text-fg"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
      </div>
      {overflowing && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("core.tabs.scrollRight")}
            disabled={!edges.right}
            onClick={() => {
              scrollBy(1);
            }}
            className={arrow}
          >
            ›
          </button>
          <MenuButton
            label={t("core.tabs.all")}
            align="right"
            className="flex h-6 w-6 shrink-0 items-center justify-center text-muted hover:text-fg"
            items={panelIds.map((panelId) => ({
              label: `${panelId === active ? "• " : ""}${title(panelId)}`,
              action: () => {
                onChoose(panelId);
              },
            }))}
          >
            ▾
          </MenuButton>
        </>
      )}
      {trailing}
    </div>
  );
}
